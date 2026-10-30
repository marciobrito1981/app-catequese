export const privacyNotice =
  'OBSERVAÇÃO: A Lei Geral de Proteção de Dados Pessoais nº 13.709, de 14 de agosto de 2018, foi promulgada com o objetivo de proteger os direitos fundamentais de liberdade e de privacidade e a livre formação da personalidade de cada indivíduo. Isso significa que os seus dados serão usados apenas para esse fim.'

export const weekdays = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
]

export function digits(value: string) {
  return value.replace(/\D/g, '')
}

export function maskCpf(value: string) {
  return digits(value)
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

export function maskPhone(value: string) {
  const phone = digits(value).slice(0, 11)
  if (phone.length < 3) return phone ? `(${phone}` : ''
  if (phone.length < 7) return `(${phone.slice(0, 2)}) ${phone.slice(2)}`
  const middle = phone.length === 11 ? 7 : 6
  return `(${phone.slice(0, 2)}) ${phone.slice(2, middle)}-${phone.slice(middle)}`
}

export function maskCep(value: string) {
  return digits(value).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
}

export function maskDate(value: string) {
  const date = digits(value).slice(0, 8)
  if (date.length <= 2) return date
  if (date.length <= 4) return `${date.slice(0, 2)}/${date.slice(2)}`
  return `${date.slice(0, 2)}/${date.slice(2, 4)}/${date.slice(4)}`
}

export function parseBrazilianDate(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  if (!match) return null
  const [, dayText, monthText, yearText] = match
  const day = Number(dayText)
  const month = Number(monthText)
  const year = Number(yearText)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return `${yearText}-${monthText}-${dayText}`
}

export function calculateAge(value: string) {
  const isoDate = parseBrazilianDate(value)
  if (!isoDate) return ''
  const [year, month, day] = isoDate.split('-').map(Number)
  const now = new Date()
  let age = now.getFullYear() - year
  if (
    now.getMonth() + 1 < month ||
    (now.getMonth() + 1 === month && now.getDate() < day)
  ) {
    age -= 1
  }
  return age >= 0 ? String(age) : ''
}

export function isValidCpf(value: string) {
  const cpf = digits(value)
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  const checkDigit = (length: number) => {
    let sum = 0
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index)
    }
    const remainder = (sum * 10) % 11
    return remainder === 10 ? 0 : remainder
  }
  return checkDigit(9) === Number(cpf[9]) && checkDigit(10) === Number(cpf[10])
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}
