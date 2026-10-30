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
    return Response.json({ error: 'Serviço de alteração de senha indisponível.' }, { status: 500, headers: corsHeaders })
  }

  let body: { new_password?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Dados inválidos.' }, { status: 400, headers: corsHeaders })
  }
  const newPassword = typeof body.new_password === 'string' ? body.new_password : ''
  if (newPassword.length < 8) {
    return Response.json({ error: 'A senha deve ter pelo menos 8 caracteres.' }, { status: 400, headers: corsHeaders })
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

  const { data: accessStatus, error: accessStatusError } = await adminClient
    .from('user_access_status')
    .select('must_change_password')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (accessStatusError) {
    console.error('Falha ao consultar o estado de acesso:', accessStatusError.message)
    return Response.json({ error: 'Não foi possível verificar o primeiro acesso.' }, { status: 500, headers: corsHeaders })
  }
  if (!accessStatus?.must_change_password) {
    return Response.json({ error: 'Não há troca inicial de senha pendente.' }, { status: 409, headers: corsHeaders })
  }

  const { error: passwordError } = await adminClient.auth.admin.updateUserById(userData.user.id, {
    password: newPassword,
  })
  if (passwordError) {
    console.error('Falha ao atualizar a senha inicial:', passwordError.message)
    return Response.json({ error: 'Não foi possível atualizar a senha. Confira os requisitos e tente novamente.' }, { status: 400, headers: corsHeaders })
  }

  const { data: updatedStatus, error: updateStatusError } = await adminClient
    .from('user_access_status')
    .update({ must_change_password: false, updated_at: new Date().toISOString() })
    .eq('user_id', userData.user.id)
    .eq('must_change_password', true)
    .select('user_id')
    .maybeSingle()
  if (updateStatusError || !updatedStatus) {
    console.error('Falha ao concluir a troca inicial de senha:', updateStatusError?.message ?? 'Estado pendente não encontrado.')
    return Response.json({ error: 'A senha foi alterada, mas não foi possível concluir o primeiro acesso. Entre novamente ou procure a secretaria.' }, { status: 500, headers: corsHeaders })
  }

  return Response.json({ success: true }, { status: 200, headers: corsHeaders })
})
