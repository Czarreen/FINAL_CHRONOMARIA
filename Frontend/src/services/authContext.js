let currentAuthUser = null;

function toSafeUser(user) {
  if (!user) return null;
  return {
    user_id: user.user_id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
  };
}

export function setCurrentAuthUser(user) {
  currentAuthUser = toSafeUser(user);
}

export function clearCurrentAuthUser() {
  currentAuthUser = null;
}

export function getCurrentAuthUser() {
  return currentAuthUser;
}

export function getAuthHeaders() {
  const user = getCurrentAuthUser();
  if (!user) return {};

  return {
    'X-User-Id': String(user.user_id || ''),
    'X-Username': String(user.username || ''),
    'X-User-Role': String(user.role || ''),
  };
}
