alter table public.wish_list_settings
  add column custom_title text
  check (
    char_length(custom_title) between 1 and 100
    and custom_title = btrim(custom_title)
    and custom_title !~ '[[:cntrl:]]'
  );

grant update (custom_title) on public.wish_list_settings to authenticated;
