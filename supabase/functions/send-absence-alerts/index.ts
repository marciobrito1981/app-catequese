import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
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
    return Response.json({ error: 'Serviço de avisos indisponível.' }, { status: 500, headers: corsHeaders })
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
  if (roleError || (callerProfile?.role !== 'coordenador' && callerProfile?.role !== 'catequista')) {
    return Response.json({ error: 'Sem permissão para enviar avisos.' }, { status: 403, headers: corsHeaders })
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('ABSENCE_ALERT_FROM')
  if (!resendKey || !from) {
    return Response.json({ configured: false, sent: 0, failed: 0 }, { status: 200, headers: corsHeaders })
  }

  const { data: pending, error: pendingError } = await adminClient
    .from('notifications')
    .select('id, recipient_email, title, message')
    .is('email_sent_at', null)
    .not('recipient_email', 'is', null)
    .order('created_at')
    .limit(50)
  if (pendingError) {
    console.error('Falha ao carregar avisos pendentes:', pendingError.message)
    return Response.json({ error: 'Não foi possível carregar os avisos pendentes.' }, { status: 500, headers: corsHeaders })
  }

  let sent = 0
  let failed = 0
  for (const item of pending ?? []) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [item.recipient_email],
        subject: item.title,
        html: `<p>${escapeHtml(item.message)}</p><p>Catequese de Adultos — Paróquia São José</p>`,
      }),
    })
    if (!response.ok) {
      failed += 1
      console.error('Falha ao enviar e-mail de aviso:', response.status)
      continue
    }
    const { error: markError } = await adminClient
      .from('notifications')
      .update({ email_sent_at: new Date().toISOString() })
      .eq('id', item.id)
    if (markError) console.error('Falha ao registrar envio do aviso:', markError.message)
    sent += 1
  }

  return Response.json({ configured: true, sent, failed }, { status: 200, headers: corsHeaders })
})
