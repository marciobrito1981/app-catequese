import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Método não permitido.' }, { status: 405, headers: corsHeaders })
  }

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return Response.json({ error: 'Autenticação necessária.' }, { status: 401, headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Variáveis necessárias do Supabase não configuradas.')
    return Response.json({ error: 'Serviço de exclusão indisponível.' }, { status: 500, headers: corsHeaders })
  }

  const token = authorization.slice('Bearer '.length)
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await callerClient.auth.getUser(token)
  if (userError || !userData.user) {
    return Response.json({ error: 'Sessão inválida ou expirada.' }, { status: 401, headers: corsHeaders })
  }

  const { data: callerProfile, error: roleError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single()
  if (roleError || callerProfile?.role !== 'coordenador') {
    return Response.json({ error: 'Somente coordenadores podem excluir catequistas.' }, { status: 403, headers: corsHeaders })
  }

  let body: { id?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Dados inválidos.' }, { status: 400, headers: corsHeaders })
  }
  if (typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)) {
    return Response.json({ error: 'Catequista inválido.' }, { status: 400, headers: corsHeaders })
  }

  const { data: catechistProfile, error: catechistError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', body.id)
    .maybeSingle()
  if (catechistError) {
    console.error('Falha ao verificar perfil para exclusão:', catechistError.message)
    return Response.json({ error: 'Não foi possível verificar o cadastro do catequista.' }, { status: 500, headers: corsHeaders })
  }
  if (catechistProfile?.role !== 'catequista') {
    return Response.json({ error: 'O perfil informado não é de catequista.' }, { status: 404, headers: corsHeaders })
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(body.id)
  if (deleteError) {
    console.error('Falha ao excluir conta do catequista:', deleteError.message)
    return Response.json({ error: 'Não foi possível excluir o catequista.' }, { status: 500, headers: corsHeaders })
  }

  return Response.json({ success: true }, { status: 200, headers: corsHeaders })
})
