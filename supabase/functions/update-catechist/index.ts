import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isValidCpf(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false
  for (const length of [9, 10]) {
    let sum = 0
    for (let index = 0; index < length; index++) sum += Number(value[index]) * (length + 1 - index)
    if (((sum * 10) % 11) % 10 !== Number(value[length])) return false
  }
  return true
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

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await callerClient.auth.getUser(authorization.slice('Bearer '.length))
  if (userError || !userData.user) {
    return Response.json({ error: 'Sessão inválida ou expirada.' }, { status: 401, headers: corsHeaders })
  }

  const { data: callerProfile, error: roleError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single()
  if (roleError || callerProfile?.role !== 'coordenador') {
    return Response.json({ error: 'Somente coordenadores podem editar catequistas.' }, { status: 403, headers: corsHeaders })
  }

  let body: { id?: unknown; full_name?: unknown; email?: unknown; phone?: unknown; cpf?: unknown; class_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Dados inválidos.' }, { status: 400, headers: corsHeaders })
  }

  const id = typeof body.id === 'string' ? body.id : ''
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const phone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : ''
  const cpf = typeof body.cpf === 'string' ? body.cpf.replace(/\D/g, '') : ''
  const classId = body.class_id === null || body.class_id === undefined || body.class_id === ''
    ? null
    : typeof body.class_id === 'string' && uuidPattern.test(body.class_id)
      ? body.class_id
      : undefined
  if (
    !uuidPattern.test(id) ||
    !fullName || fullName.length > 150 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
    !/^\d{10,11}$/.test(phone) ||
    !isValidCpf(cpf) ||
    classId === undefined
  ) {
    return Response.json({ error: 'Informe nome, e-mail, telefone, CPF e turma válidos.' }, { status: 400, headers: corsHeaders })
  }

  const { data: catechist, error: catechistError } = await adminClient
    .from('t_catequista')
    .select('id, email, cpf, class_id')
    .eq('id', id)
    .maybeSingle()
  if (catechistError) {
    console.error('Falha ao localizar catequista:', catechistError.message)
    return Response.json({ error: 'Não foi possível localizar o catequista.' }, { status: 500, headers: corsHeaders })
  }
  if (!catechist) {
    return Response.json({ error: 'Catequista não encontrado.' }, { status: 404, headers: corsHeaders })
  }

  if (classId && classId !== catechist.class_id) {
    const { data: classRecord, error: classError } = await adminClient
      .from('classes')
      .select('id')
      .eq('id', classId)
      .eq('active', true)
      .maybeSingle()
    if (classError) {
      console.error('Falha ao verificar turma do catequista:', classError.message)
      return Response.json({ error: 'Não foi possível verificar a turma selecionada.' }, { status: 500, headers: corsHeaders })
    }
    if (!classRecord) {
      return Response.json({ error: 'A turma selecionada não está ativa ou não existe.' }, { status: 400, headers: corsHeaders })
    }
  }

  if (catechist.cpf !== cpf) {
    const { data: cpfOwner, error: cpfError } = await adminClient
      .from('t_catequista')
      .select('id')
      .eq('cpf', cpf)
      .neq('id', id)
      .maybeSingle()
    if (cpfError) {
      console.error('Falha ao verificar CPF do catequista:', cpfError.message)
      return Response.json({ error: 'Não foi possível verificar o CPF informado.' }, { status: 500, headers: corsHeaders })
    }
    if (cpfOwner) {
      return Response.json({ error: 'Já existe um catequista cadastrado com este CPF.' }, { status: 409, headers: corsHeaders })
    }
  }

  const previousEmail = catechist.email
  const emailChanged = previousEmail?.toLowerCase() !== email
  if (emailChanged) {
    const { error: authError } = await adminClient.auth.admin.updateUserById(id, {
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName, phone },
    })
    if (authError) {
      console.error('Falha ao atualizar o e-mail de acesso:', authError.message)
      return Response.json({ error: 'Não foi possível atualizar o e-mail. Confira se ele já está em uso.' }, { status: 400, headers: corsHeaders })
    }
  } else {
    const { error: metadataError } = await adminClient.auth.admin.updateUserById(id, {
      user_metadata: { full_name: fullName, phone },
    })
    if (metadataError) console.error('Falha ao sincronizar metadados do catequista:', metadataError.message)
  }

  const { error: updateError } = await adminClient
    .from('t_catequista')
    .update({ full_name: fullName, phone, email, cpf, class_id: classId })
    .eq('id', id)
  if (updateError) {
    console.error('Falha ao atualizar catequista:', updateError.message)
    if (emailChanged && previousEmail) {
      const { error: revertError } = await adminClient.auth.admin.updateUserById(id, {
        email: previousEmail,
        email_confirm: true,
      })
      if (revertError) console.error('Falha ao reverter e-mail de acesso:', revertError.message)
    }
    return Response.json({ error: 'Não foi possível atualizar o cadastro do catequista.' }, { status: 500, headers: corsHeaders })
  }

  return Response.json({ id }, { status: 200, headers: corsHeaders })
})
