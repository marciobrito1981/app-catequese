create or replace function public.is_valid_cpf(p_cpf text)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  cpf_digits text := regexp_replace(p_cpf, '[^0-9]', '', 'g');
  sum_digits integer;
  remainder integer;
  expected_digit integer;
  digit_index integer;
  weight_position integer;
begin
  if length(cpf_digits) <> 11 or cpf_digits ~ '^([0-9])\1{10}$' then
    return false;
  end if;

  for digit_index in 9..10 loop
    sum_digits := 0;
    for weight_position in 1..digit_index loop
      sum_digits := sum_digits + substring(cpf_digits from weight_position for 1)::integer * (digit_index + 2 - weight_position);
    end loop;
    remainder := (sum_digits * 10) % 11;
    expected_digit := case when remainder = 10 then 0 else remainder end;
    if substring(cpf_digits from digit_index + 1 for 1)::integer <> expected_digit then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.is_valid_cpf(text) from public;
