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
    return Response.json({ error: 'Serviço de criação de usuário indisponível.' }, { status: 500, headers: corsHeaders })
  }

  let body: { registration_id?: unknown; provisional_password?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Dados inválidos.' }, { status: 400, headers: corsHeaders })
  }

  const registrationId = typeof body.registration_id === 'string' ? body.registration_id : ''
  const provisionalPassword = typeof body.provisional_password === 'string'
    ? body.provisional_password
    : ''
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(registrationId) ||
    provisionalPassword.length < 8
  ) {
    return Response.json({ error: 'Inscrição ou senha provisória inválida.' }, { status: 400, headers: corsHeaders })
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const token = authorization.slice('Bearer '.length)
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
    return Response.json({ error: 'Somente administradores podem criar usuários de catequizandos.' }, { status: 403, headers: corsHeaders })
  }

  const { data: registration, error: registrationError } = await adminClient
    .from('t_catequizando')
    .select('id, full_name, email, phone, user_id')
    .eq('id', registrationId)
    .single()
  if (registrationError || !registration) {
    return Response.json({ error: 'Inscrição não encontrada.' }, { status: 404, headers: corsHeaders })
  }
  if (!registration.email) {
    return Response.json({ error: 'A inscrição não possui e-mail para criar o usuário.' }, { status: 400, headers: corsHeaders })
  }
  if (registration.user_id) {
    return Response.json({ error: 'Esta inscrição já está vinculada a um usuário do sistema.' }, { status: 409, headers: corsHeaders })
  }

  const { data: createdUserData, error: createUserError } = await adminClient.auth.admin.createUser({
    email: registration.email,
    email_confirm: true,
    password: provisionalPassword,
    user_metadata: { full_name: registration.full_name, phone: registration.phone },
  })
  if (createUserError || !createdUserData.user) {
    console.error('Falha ao criar usuário do catequizando:', createUserError?.message)
    return Response.json({
      error: 'Não foi possível criar o usuário. O e-mail pode já estar cadastrado.',
    }, { status: 400, headers: corsHeaders })
  }
  const createdUser = createdUserData.user

  const { error: profileError } = await adminClient
    .from('profiles')
    .update({ role: 'catequizando' })
    .eq('id', createdUser.id)
  if (profileError) {
    console.error('Falha ao configurar o perfil do catequizando:', profileError.message)
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(createdUser.id)
    if (cleanupError) console.error('Falha ao remover usuário incompleto:', cleanupError.message)
    return Response.json({ error: 'Não foi possível configurar o perfil do usuário.' }, { status: 500, headers: corsHeaders })
  }

  const { error: accessStatusError } = await adminClient
    .from('user_access_status')
    .upsert({ user_id: createdUser.id, must_change_password: true })
  if (accessStatusError) {
    console.error('Falha ao exigir a troca da senha provisória:', accessStatusError.message)
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(createdUser.id)
    if (cleanupError) console.error('Falha ao remover usuário incompleto:', cleanupError.message)
    return Response.json({ error: 'Não foi possível configurar a troca de senha no primeiro acesso.' }, { status: 500, headers: corsHeaders })
  }

  const { data: linkedRegistration, error: linkError } = await adminClient
    .from('t_catequizando')
    .update({ user_id: createdUser.id })
    .eq('id', registration.id)
    .is('user_id', null)
    .select('id')
    .maybeSingle()
  let alreadyLinkedByEmailTrigger = false
  if (!linkError && !linkedRegistration) {
    const { data: currentRegistration, error: currentRegistrationError } = await adminClient
      .from('t_catequizando')
      .select('user_id')
      .eq('id', registration.id)
      .single()
    if (currentRegistrationError) {
      console.error('Falha ao verificar vínculo da inscrição:', currentRegistrationError.message)
    } else {
      alreadyLinkedByEmailTrigger = currentRegistration.user_id === createdUser.id
    }
  }
  if (linkError || (!linkedRegistration && !alreadyLinkedByEmailTrigger)) {
    console.error('Falha ao vincular usuário à inscrição:', linkError?.message ?? 'Inscrição já vinculada.')
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(createdUser.id)
    if (cleanupError) console.error('Falha ao remover usuário não vinculado:', cleanupError.message)
    return Response.json({ error: 'Não foi possível vincular o usuário à inscrição.' }, { status: 409, headers: corsHeaders })
  }

  return Response.json({ user_id: createdUser.id }, { status: 200, headers: corsHeaders })
})
