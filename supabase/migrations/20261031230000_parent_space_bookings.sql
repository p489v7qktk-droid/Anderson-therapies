create extension if not exists pgcrypto;

create table public.parent_space_settings (
    event_key text primary key check (event_key = 'parent-space-2027'),
    capacity integer not null default 15 check (capacity > 0),
    early_bird_limit integer not null default 8 check (early_bird_limit > 0),
    early_bird_cutoff date not null default date '2027-02-01',
    early_bird_payment_url text not null,
    standard_payment_url text,
    updated_at timestamptz not null default now(),
    constraint valid_early_bird_url check (early_bird_payment_url like 'https://pay.tide.co/%'),
    constraint valid_standard_url check (
        standard_payment_url is null or standard_payment_url like 'https://pay.tide.co/%'
    )
);

insert into public.parent_space_settings (
    event_key,
    early_bird_payment_url
) values (
    'parent-space-2027',
    'https://pay.tide.co/5603dc2e-79ce-43a8-a29c-9f06b160c4ec'
);

create table public.parent_space_bookings (
    id uuid primary key default gen_random_uuid(),
    idempotency_key uuid not null unique,
    booking_reference text not null unique,
    full_name text not null,
    email text not null,
    telephone text not null,
    photo_consent boolean,
    access_needs text,
    amount_due_pence integer not null check (amount_due_pence in (2000, 3000)),
    payment_url text not null check (payment_url like 'https://pay.tide.co/%'),
    status text not null default 'pending_payment'
        check (status in ('pending_payment', 'paid', 'expired', 'payment_review', 'cancelled')),
    amount_paid_pence integer check (amount_paid_pence is null or amount_paid_pence >= 0),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    paid_at timestamptz,
    updated_at timestamptz not null default now(),
    check (length(trim(full_name)) between 1 and 120),
    check (length(email) between 3 and 254),
    check (length(trim(telephone)) between 3 and 40),
    check (access_needs is null or length(access_needs) <= 1200)
);

create index parent_space_bookings_status_expiry_idx
    on public.parent_space_bookings (status, expires_at);
create index parent_space_bookings_created_idx
    on public.parent_space_bookings (created_at desc);
create unique index parent_space_bookings_active_attendee_idx
    on public.parent_space_bookings (lower(full_name), lower(email))
    where status in ('pending_payment', 'paid', 'payment_review');

create table public.parent_space_email_deliveries (
    id uuid primary key default gen_random_uuid(),
    booking_id uuid not null references public.parent_space_bookings(id) on delete cascade,
    kind text not null check (kind in ('pending', 'confirmation')),
    request_id uuid not null,
    idempotency_key text not null unique,
    status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
    provider_id text,
    error_message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    sent_at timestamptz,
    unique (booking_id, kind, request_id)
);

create table public.parent_space_rate_limit_events (
    bucket_key text not null,
    created_at timestamptz not null default now()
);

create index parent_space_rate_limit_events_lookup_idx
    on public.parent_space_rate_limit_events (bucket_key, created_at desc);

alter table public.parent_space_settings enable row level security;
alter table public.parent_space_bookings enable row level security;
alter table public.parent_space_email_deliveries enable row level security;
alter table public.parent_space_rate_limit_events enable row level security;

revoke all on public.parent_space_settings from anon, authenticated;
revoke all on public.parent_space_bookings from anon, authenticated;
revoke all on public.parent_space_email_deliveries from anon, authenticated;
revoke all on public.parent_space_rate_limit_events from anon, authenticated;
grant all on public.parent_space_settings to service_role;
grant all on public.parent_space_bookings to service_role;
grant all on public.parent_space_email_deliveries to service_role;
grant all on public.parent_space_rate_limit_events to service_role;

create or replace function public.consume_parent_space_booking_rate_limit(
    p_ip_hash text,
    p_email_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ip_key text;
    v_email_key text;
    v_ip_count integer;
    v_email_count integer;
begin
    if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$'
       or (p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$') then
        return jsonb_build_object('ok', false, 'allowed', false);
    end if;

    v_ip_key := case when p_ip_hash is null then null else 'ip:' || p_ip_hash end;
    v_email_key := 'email:' || p_email_hash;

    perform pg_advisory_xact_lock(hashtextextended(v_email_key, 0));
    if v_ip_key is not null then
        perform pg_advisory_xact_lock(hashtextextended(v_ip_key, 0));
    end if;

    delete from public.parent_space_rate_limit_events
    where created_at < now() - interval '1 hour';

    if v_ip_key is not null then
        select count(*) into v_ip_count
        from public.parent_space_rate_limit_events
        where bucket_key = v_ip_key and created_at > now() - interval '1 hour';
        if v_ip_count >= 10 then
            return jsonb_build_object('ok', true, 'allowed', false);
        end if;
    end if;

    select count(*) into v_email_count
    from public.parent_space_rate_limit_events
    where bucket_key = v_email_key and created_at > now() - interval '1 hour';
    if v_email_count >= 5 then
        return jsonb_build_object('ok', true, 'allowed', false);
    end if;

    insert into public.parent_space_rate_limit_events (bucket_key)
    values (v_email_key);
    if v_ip_key is not null then
        insert into public.parent_space_rate_limit_events (bucket_key)
        values (v_ip_key);
    end if;

    return jsonb_build_object('ok', true, 'allowed', true);
end;
$$;

create or replace function public.parent_space_config()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_settings public.parent_space_settings%rowtype;
    v_paid_count integer;
    v_reserved_count integer;
    v_is_early_bird boolean;
    v_price integer;
    v_payment_url text;
    v_qr_path text;
begin
    select * into strict v_settings
    from public.parent_space_settings
    where event_key = 'parent-space-2027';

    update public.parent_space_bookings
    set status = 'expired', updated_at = now()
    where status = 'pending_payment' and expires_at <= now();

    delete from public.parent_space_rate_limit_events
    where created_at < now() - interval '1 hour';

    select count(*) into v_paid_count
    from public.parent_space_bookings
    where status = 'paid' and amount_due_pence = 2000;

    select count(*) into v_reserved_count
    from public.parent_space_bookings
    where status = 'paid'
       or (status = 'pending_payment' and expires_at > now());

    v_is_early_bird := current_date < v_settings.early_bird_cutoff
        and v_paid_count < v_settings.early_bird_limit;
    v_price := case when v_is_early_bird then 2000 else 3000 end;
    v_payment_url := case
        when v_is_early_bird then v_settings.early_bird_payment_url
        else v_settings.standard_payment_url
    end;
    v_qr_path := case when v_is_early_bird then '../parent-space-payment-qr.png' else null end;

    return jsonb_build_object(
        'early_bird_sold', v_paid_count,
        'early_bird_limit', v_settings.early_bird_limit,
        'early_bird_cutoff', v_settings.early_bird_cutoff,
        'capacity', v_settings.capacity,
        'places_reserved', v_reserved_count,
        'price_pence', v_price,
        'is_early_bird', v_is_early_bird,
        'payment_url', v_payment_url,
        'standard_payment_url', v_settings.standard_payment_url,
        'qr_path', v_qr_path,
        'booking_open', v_reserved_count < v_settings.capacity and v_payment_url is not null,
        'payment_link_ready', v_payment_url is not null
    );
end;
$$;

create or replace function public.create_parent_space_booking(
    p_idempotency_key uuid,
    p_full_name text,
    p_email text,
    p_telephone text,
    p_photo_consent boolean,
    p_access_needs text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_settings public.parent_space_settings%rowtype;
    v_existing public.parent_space_bookings%rowtype;
    v_booking public.parent_space_bookings%rowtype;
    v_paid_count integer;
    v_reserved_count integer;
    v_price integer;
    v_payment_url text;
    v_reference text;
begin
    if p_idempotency_key is null
       or p_full_name is null or length(trim(p_full_name)) not between 1 and 120
       or p_email is null or length(trim(p_email)) not between 3 and 254
       or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       or p_telephone is null or length(trim(p_telephone)) not between 3 and 40
       or (p_access_needs is not null and length(p_access_needs) > 1200) then
        return jsonb_build_object('ok', false, 'error', 'Please check the booking details and try again.');
    end if;

    select * into v_existing
    from public.parent_space_bookings
    where idempotency_key = p_idempotency_key;

    if found then
        return jsonb_build_object('ok', true, 'booking', to_jsonb(v_existing));
    end if;

    select * into strict v_settings
    from public.parent_space_settings
    where event_key = 'parent-space-2027'
    for update;

    select * into v_existing
    from public.parent_space_bookings
    where idempotency_key = p_idempotency_key;

    if found then
        return jsonb_build_object('ok', true, 'booking', to_jsonb(v_existing));
    end if;

    update public.parent_space_bookings
    set status = 'expired', updated_at = now()
    where status = 'pending_payment' and expires_at <= now();

    select * into v_existing
    from public.parent_space_bookings
    where lower(full_name) = lower(trim(p_full_name))
      and lower(email) = lower(trim(p_email))
      and status in ('pending_payment', 'paid', 'payment_review')
    order by created_at desc
    limit 1;

    if found then
        return jsonb_build_object('ok', true, 'booking', to_jsonb(v_existing), 'existing_attendee', true);
    end if;

    select count(*) into v_paid_count
    from public.parent_space_bookings
    where status = 'paid' and amount_due_pence = 2000;

    select count(*) into v_reserved_count
    from public.parent_space_bookings
    where status = 'paid'
       or (status = 'pending_payment' and expires_at > now());

    if v_reserved_count >= v_settings.capacity then
        return jsonb_build_object('ok', false, 'error', 'There are no places currently available.');
    end if;

    if current_date < v_settings.early_bird_cutoff
       and v_paid_count < v_settings.early_bird_limit then
        v_price := 2000;
        v_payment_url := v_settings.early_bird_payment_url;
    else
        v_price := 3000;
        v_payment_url := v_settings.standard_payment_url;
    end if;

    if v_payment_url is null then
        return jsonb_build_object(
            'ok', false,
            'error', 'Standard ticket payment is being set up. Please try again later or contact Anderson Therapies.'
        );
    end if;

    v_reference := 'PS-270228-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    insert into public.parent_space_bookings (
        idempotency_key,
        booking_reference,
        full_name,
        email,
        telephone,
        photo_consent,
        access_needs,
        amount_due_pence,
        payment_url,
        expires_at
    ) values (
        p_idempotency_key,
        v_reference,
        trim(p_full_name),
        lower(trim(p_email)),
        trim(p_telephone),
        p_photo_consent,
        nullif(trim(p_access_needs), ''),
        v_price,
        v_payment_url,
        now() + interval '30 minutes'
    )
    returning * into v_booking;

    return jsonb_build_object(
        'ok', true,
        'booking', to_jsonb(v_booking),
        'first_name', split_part(trim(v_booking.full_name), ' ', 1)
    );
end;
$$;

create or replace function public.admin_mark_parent_space_booking_paid(
    p_booking_id uuid,
    p_amount_paid_pence integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_settings public.parent_space_settings%rowtype;
    v_booking public.parent_space_bookings%rowtype;
    v_paid_count integer;
    v_reserved_count integer;
begin
    select * into strict v_settings
    from public.parent_space_settings
    where event_key = 'parent-space-2027'
    for update;

    select * into v_booking
    from public.parent_space_bookings
    where id = p_booking_id
    for update;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'Booking not found.');
    end if;

    if v_booking.status = 'paid' then
        return jsonb_build_object('ok', true, 'already_paid', true, 'booking', to_jsonb(v_booking));
    end if;

    if v_booking.status not in ('pending_payment', 'expired', 'payment_review') then
        return jsonb_build_object('ok', false, 'error', 'This booking cannot be marked as paid.');
    end if;

    if p_amount_paid_pence is distinct from v_booking.amount_due_pence then
        update public.parent_space_bookings
        set status = 'payment_review',
            amount_paid_pence = p_amount_paid_pence,
            updated_at = now()
        where id = p_booking_id
        returning * into v_booking;

        return jsonb_build_object(
            'ok', false,
            'error', 'The amount Tide received does not match the ticket price. This booking was flagged for review and no confirmation was sent.',
            'booking', to_jsonb(v_booking)
        );
    end if;

    if v_booking.amount_due_pence = 2000 then
        select count(*) into v_paid_count
        from public.parent_space_bookings
        where status = 'paid' and amount_due_pence = 2000;

        if v_paid_count >= v_settings.early_bird_limit then
            update public.parent_space_bookings
            set status = 'payment_review',
                amount_paid_pence = p_amount_paid_pence,
                updated_at = now()
            where id = p_booking_id
            returning * into v_booking;

            return jsonb_build_object(
                'ok', false,
                'error', 'The early-bird allocation is already full. This payment was flagged for review and no confirmation was sent.',
                'booking', to_jsonb(v_booking)
            );
        end if;
    end if;

    update public.parent_space_bookings
    set status = 'expired', updated_at = now()
    where status = 'pending_payment' and expires_at <= now();

    select count(*) into v_reserved_count
    from public.parent_space_bookings
    where id <> p_booking_id
      and (status = 'paid'
       or (status = 'pending_payment' and expires_at > now()));

    if v_reserved_count >= v_settings.capacity then
        update public.parent_space_bookings
        set status = 'payment_review',
            amount_paid_pence = p_amount_paid_pence,
            updated_at = now()
        where id = p_booking_id
        returning * into v_booking;

        return jsonb_build_object(
            'ok', false,
            'error', 'There is no longer a place available. This payment was flagged for review and no confirmation was sent.',
            'booking', to_jsonb(v_booking)
        );
    end if;

    update public.parent_space_bookings
    set status = 'paid',
        amount_paid_pence = p_amount_paid_pence,
        paid_at = now(),
        updated_at = now()
    where id = p_booking_id
    returning * into v_booking;

    return jsonb_build_object('ok', true, 'booking', to_jsonb(v_booking));
end;
$$;

create or replace function public.claim_parent_space_email(
    p_booking_id uuid,
    p_kind text,
    p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_booking public.parent_space_bookings%rowtype;
    v_delivery public.parent_space_email_deliveries%rowtype;
    v_key text;
begin
    if p_kind not in ('pending', 'confirmation') or p_request_id is null then
        return jsonb_build_object('ok', false, 'error', 'Invalid email request.');
    end if;

    select * into v_booking
    from public.parent_space_bookings
    where id = p_booking_id;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'Booking not found.');
    end if;

    if (p_kind = 'pending' and v_booking.status <> 'pending_payment')
       or (p_kind = 'confirmation' and v_booking.status <> 'paid') then
        return jsonb_build_object('ok', false, 'error', 'Email does not match the booking payment status.');
    end if;

    if p_kind = 'pending' and exists (
        select 1 from public.parent_space_email_deliveries
        where booking_id = p_booking_id and kind = 'pending' and status = 'sent'
    ) then
        return jsonb_build_object('ok', true, 'send', false, 'reason', 'already_sent');
    end if;

    v_key := 'parent-space/' || p_kind || '/' || p_booking_id::text || '/' || p_request_id::text;

    insert into public.parent_space_email_deliveries as existing_delivery (
        booking_id, kind, request_id, idempotency_key
    ) values (
        p_booking_id, p_kind, p_request_id, v_key
    )
    on conflict (booking_id, kind, request_id) do update
    set status = 'sending', error_message = null, updated_at = now()
    where existing_delivery.status = 'failed'
    returning * into v_delivery;

    if not found then
        select * into v_delivery
        from public.parent_space_email_deliveries
        where booking_id = p_booking_id and kind = p_kind and request_id = p_request_id;
        return jsonb_build_object('ok', true, 'send', false, 'reason', v_delivery.status);
    end if;

    return jsonb_build_object(
        'ok', true,
        'send', true,
        'email_id', v_delivery.id,
        'idempotency_key', v_delivery.idempotency_key,
        'booking', to_jsonb(v_booking)
    );
end;
$$;

create or replace function public.finish_parent_space_email(
    p_email_id uuid,
    p_status text,
    p_provider_id text,
    p_error_message text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if p_status not in ('sent', 'failed') then
        raise exception 'Invalid email status';
    end if;

    update public.parent_space_email_deliveries
    set status = p_status,
        provider_id = p_provider_id,
        error_message = left(p_error_message, 500),
        sent_at = case when p_status = 'sent' then now() else null end,
        updated_at = now()
    where id = p_email_id;
end;
$$;

create or replace function public.admin_set_parent_space_standard_link(p_payment_url text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if p_payment_url is null or p_payment_url !~ '^https://pay\.tide\.co/[A-Za-z0-9-]+/?$' then
        raise exception 'Enter a valid Tide payment link';
    end if;

    update public.parent_space_settings
    set standard_payment_url = p_payment_url,
        updated_at = now()
    where event_key = 'parent-space-2027';
end;
$$;

revoke all on function public.parent_space_config() from public, anon, authenticated;
revoke all on function public.consume_parent_space_booking_rate_limit(text, text) from public, anon, authenticated;
revoke all on function public.create_parent_space_booking(uuid, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.admin_mark_parent_space_booking_paid(uuid, integer) from public, anon, authenticated;
revoke all on function public.claim_parent_space_email(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.finish_parent_space_email(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_set_parent_space_standard_link(text) from public, anon, authenticated;

grant execute on function public.parent_space_config() to service_role;
grant execute on function public.consume_parent_space_booking_rate_limit(text, text) to service_role;
grant execute on function public.create_parent_space_booking(uuid, text, text, text, boolean, text) to service_role;
grant execute on function public.admin_mark_parent_space_booking_paid(uuid, integer) to service_role;
grant execute on function public.claim_parent_space_email(uuid, text, uuid) to service_role;
grant execute on function public.finish_parent_space_email(uuid, text, text, text) to service_role;
grant execute on function public.admin_set_parent_space_standard_link(text) to service_role;
