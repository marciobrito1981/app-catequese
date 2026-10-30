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
    return Response.json({ error: 'Serviço de cadastro indisponível.' }, { status: 500, headers: corsHeaders })
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
  if (roleError || callerProfile?.role !== 'administrador') {
    return Response.json({ error: 'Somente administradores podem cadastrar catequistas.' }, { status: 403, headers: corsHeaders })
  }

  let body: { full_name?: unknown; email?: unknown; phone?: unknown; role?: unknown; send_invite?: unknown; initial_password?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Dados inválidos.' }, { status: 400, headers: corsHeaders })
  }

  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const phone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : ''
  const role = body.role
  const sendInvite = body.send_invite !== false
  const initialPassword = typeof body.initial_password === 'string' ? body.initial_password : ''
  if (
    !fullName || fullName.length > 150 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
    !/^\d{10,11}$/.test(phone) ||
    (role !== 'administrador' && role !== 'catequista' && role !== 'catequizando') ||
    (!sendInvite && (role !== 'catequista' || initialPassword.length < 8))
  ) {
    return Response.json({ error: 'Informe nome, e-mail, telefone e perfil válidos.' }, { status: 400, headers: corsHeaders })
  }

  const userResult = sendInvite
    ? await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, phone },
    })
    : await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      password: initialPassword,
      user_metadata: { full_name: fullName, phone },
    })
  if (userResult.error || !userResult.data.user) {
    console.error(sendInvite ? 'Falha ao convidar catequista:' : 'Falha ao cadastrar catequista:', userResult.error?.message)
    return Response.json({
      error: sendInvite
        ? 'Não foi possível enviar o convite. Confira o e-mail e tente novamente.'
        : 'Não foi possível cadastrar o catequista. Confira se o e-mail já está cadastrado.',
    }, { status: 400, headers: corsHeaders })
  }
  const createdUser = userResult.data.user

  const { error: profileError } = await adminClient
    .from('profiles')
    .update({ role })
    .eq('id', createdUser.id)
  if (profileError) {
    console.error('Falha ao configurar papel do usuário:', profileError.message)
    return Response.json({ error: 'O cadastro foi criado, mas não foi possível configurar o perfil. Procure a secretaria paroquial.' }, { status: 500, headers: corsHeaders })
  }

  if (role === 'catequista') {
    const { error: catechistError } = await adminClient
      .from('t_catequista')
      .upsert({ id: createdUser.id, full_name: fullName, phone })
    if (catechistError) {
      console.error('Falha ao criar cadastro de catequista:', catechistError.message)
      return Response.json({ error: 'O usuário foi criado, mas não foi possível criar o cadastro de catequista. Procure a secretaria paroquial.' }, { status: 500, headers: corsHeaders })
    }
    if (!sendInvite) {
      const { error: accessStatusError } = await adminClient
        .from('user_access_status')
        .upsert({ user_id: createdUser.id, must_change_password: true })
      if (accessStatusError) {
        console.error('Falha ao exigir troca da senha inicial:', accessStatusError.message)
        return Response.json({ error: 'O catequista foi cadastrado, mas não foi possível exigir a troca da senha inicial. Procure a secretaria paroquial.' }, { status: 500, headers: corsHeaders })
      }
    }
  }

  return Response.json({ id: createdUser.id, role }, { status: 200, headers: corsHeaders })
})
