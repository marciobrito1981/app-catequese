import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
    return Response.json({ error: 'Serviço indisponível.' }, { status: 500, headers: corsHeaders })
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
    return Response.json({ error: 'Somente coordenadores podem gerenciar catequizandos.' }, { status: 403, headers: corsHeaders })
  }

  let body: { id?: unknown; action?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Dados inválidos.' }, { status: 400, headers: corsHeaders })
  }
  if (typeof body.id !== 'string' || !uuidPattern.test(body.id)) {
    return Response.json({ error: 'Catequizando inválido.' }, { status: 400, headers: corsHeaders })
  }
  if (body.action !== 'deactivate' && body.action !== 'activate' && body.action !== 'delete') {
    return Response.json({ error: 'Ação inválida.' }, { status: 400, headers: corsHeaders })
  }

  const { data: catequizando, error: findError } = await adminClient
    .from('t_catequizando')
    .select('id, user_id')
    .eq('id', body.id)
    .maybeSingle()
  if (findError) {
    console.error('Falha ao localizar catequizando:', findError.message)
    return Response.json({ error: 'Não foi possível localizar o catequizando.' }, { status: 500, headers: corsHeaders })
  }
  if (!catequizando) {
    return Response.json({ error: 'Catequizando não encontrado.' }, { status: 404, headers: corsHeaders })
  }

  if (catequizando.user_id) {
    const { data: targetProfile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', catequizando.user_id)
      .maybeSingle()
    if (targetProfile && targetProfile.role !== 'catequizando') {
      return Response.json({ error: 'O usuário vinculado não tem perfil de catequizando.' }, { status: 409, headers: corsHeaders })
    }
  }

  if (body.action === 'delete') {
    const { error: deleteRowError } = await adminClient.from('t_catequizando').delete().eq('id', catequizando.id)
    if (deleteRowError) {
      console.error('Falha ao excluir cadastro:', deleteRowError.message)
      return Response.json({ error: 'Não foi possível excluir o catequizando.' }, { status: 500, headers: corsHeaders })
    }
    if (catequizando.user_id) {
      const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(catequizando.user_id)
      if (deleteUserError) {
        console.error('Falha ao excluir conta do catequizando:', deleteUserError.message)
        return Response.json({ error: 'Cadastro excluído, mas a conta de acesso não pôde ser removida.' }, { status: 500, headers: corsHeaders })
      }
    }
    return Response.json({ success: true }, { status: 200, headers: corsHeaders })
  }

  const activate = body.action === 'activate'
  if (catequizando.user_id) {
    const { error: banError } = await adminClient.auth.admin.updateUserById(catequizando.user_id, {
      ban_duration: activate ? 'none' : '876000h',
    })
    if (banError) {
      console.error('Falha ao atualizar acesso do catequizando:', banError.message)
      return Response.json({ error: 'Não foi possível atualizar o acesso do catequizando.' }, { status: 500, headers: corsHeaders })
    }
  }
  const { error: updateError } = await adminClient.from('t_catequizando').update({ active: activate }).eq('id', catequizando.id)
  if (updateError) {
    console.error('Falha ao atualizar situação:', updateError.message)
    return Response.json({ error: 'Não foi possível atualizar a situação do catequizando.' }, { status: 500, headers: corsHeaders })
  }

  return Response.json({ success: true, active: activate }, { status: 200, headers: corsHeaders })
})
