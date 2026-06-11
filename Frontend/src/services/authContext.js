let currentAuthUser = null;
let currentAuthToken = null;

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

export function setCurrentAuthToken(token) {
  currentAuthToken = token || null;
}

export function clearCurrentAuthUser() {
  currentAuthUser = null;
  currentAuthToken = null;
}

export function getCurrentAuthUser() {
  return currentAuthUser;
}

export function getAuthHeaders() {
  if (!currentAuthToken) return {};
  return { Authorization: `Bearer ${currentAuthToken}` };
}
