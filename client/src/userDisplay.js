// Users created before first/last name existed have neither — fall back to
// their email so every list/dropdown always has something to show.
export function formatUserName(user) {
  if (!user) return '';
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || user.email;
}
