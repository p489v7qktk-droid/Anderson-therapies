alter table public.parent_space_bookings
    add column attendee_type text,
    add column age_groups text[],
    add column heard_about text,
    add column marketing_opt_in boolean not null default false,
    add constraint parent_space_bookings_attendee_type_check
        check (attendee_type is null or attendee_type in ('Parent or carer', 'Professional working with children and young people', 'Both', 'Other')),
    add constraint parent_space_bookings_heard_about_check
        check (heard_about is null or heard_about in ('Instagram', 'LinkedIn', 'WhatsApp', 'Friend or colleague', 'Oak House', 'Other')),
    add constraint parent_space_bookings_age_groups_check
        check (age_groups is null or age_groups <@ array['0–4 years', '5–10 years', '11–16 years', '17+ years']);
