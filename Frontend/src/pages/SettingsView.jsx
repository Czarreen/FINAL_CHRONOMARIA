import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Edit3, Eye, EyeOff, Search, Shield, Trash2, UserPlus, Users } from 'lucide-react';
import { createUser, deleteUser, fetchUsers, updateUser } from '../services/usersApi.js';

const EMPTY_USER = {
  username: '',
  email: '',
  password: '',
  role: 'admin',
  status: 'active',
};

const ROLE_OPTIONS = ['super-admin', 'admin'];

export default function SettingsView({ currentUser, onUserUpdate }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [formData, setFormData] = useState(EMPTY_USER);
  
  // Admin personalized settings state
  const [adminEditMode, setAdminEditMode] = useState({
    username: false,
    email: false,
    password: false,
  });
  const [adminFormData, setAdminFormData] = useState({
    username: currentUser?.username || '',
    email: currentUser?.email || '',
    password: '',
  });
  const [currentPassword, setCurrentPassword] = useState(currentUser?.password || '');
  const [displayPassword, setDisplayPassword] = useState(currentUser?.password || '');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Super admin modal password visibility states
  const [showModalPassword, setShowModalPassword] = useState(false);
  const [showModalConfirmPassword, setShowModalConfirmPassword] = useState(false);
  const [modalConfirmPassword, setModalConfirmPassword] = useState('');
  const [modalError, setModalError] = useState('');

  const isAdmin = currentUser?.role === 'admin';
  const isSuperAdmin = currentUser?.role === 'super-admin';

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetchUsers({ search, status: statusFilter });
      setUsers(response.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users.');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      loadUsers();
    }
  }, [search, statusFilter, isSuperAdmin]);

  useEffect(() => {
    // Update current password when currentUser changes
    setCurrentPassword(currentUser?.password || '');
    setDisplayPassword(currentUser?.password || '');
  }, [currentUser]);

  const stats = useMemo(() => {
    const active = users.filter((user) => String(user.status || '').toLowerCase() === 'active').length;
    const admins = users.filter((user) => String(user.role || '').toLowerCase() === 'admin').length;
    return { total: users.length, active, admins };
  }, [users]);

  const openCreateModal = () => {
    setFormData(EMPTY_USER);
    setShowAddModal(true);
    setEditingUser(null);
    setError('');
    setModalError('');
  };

  const openEditModal = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username || '',
      email: user.email || '',
      password: '',
      role: user.role || 'admin',
      status: user.status || 'active',
    });
    setShowAddModal(false);
    setError('');
    setModalError('');
  };

  const closeModals = () => {
    setShowAddModal(false);
    setEditingUser(null);
    setDeleteTarget(null);
    setFormData(EMPTY_USER);
    setModalConfirmPassword('');
    setShowModalPassword(false);
    setShowModalConfirmPassword(false);
    setModalError('');
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      setModalError('');

      const payload = {
        username: formData.username.trim(),
        email: formData.email.trim() || null,
        role: formData.role.trim() || 'admin',
        status: formData.status.trim() || 'active',
      };

      if (showAddModal) {
        if (!formData.password.trim()) {
          setModalError('Password is required when creating a new user.');
          setSaving(false);
          return;
        }
        if (formData.password !== modalConfirmPassword) {
          setModalError('Passwords do not match. Please verify both fields.');
          setSaving(false);
          return;
        }
        payload.password = formData.password;
        await createUser(payload);
        setSuccess('User created successfully.');
      } else if (editingUser) {
        if (formData.password.trim()) {
          if (formData.password !== modalConfirmPassword) {
            setModalError('Passwords do not match. Please verify both fields.');
            setSaving(false);
            return;
          }
          payload.password = formData.password;
        }
        await updateUser(editingUser.user_id, payload);
        setSuccess('User updated successfully.');
      }

      closeModals();
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save user.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    try {
      setSaving(true);
      setError('');
      await deleteUser(deleteTarget.user_id);
      setSuccess('User deleted successfully.');
      setDeleteTarget(null);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete user.');
    } finally {
      setSaving(false);
    }
  };

  const handleAdminSave = async (field) => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');

      const payload = {};
      
      if (field === 'username' && adminFormData.username.trim()) {
        payload.username = adminFormData.username.trim();
      } else if (field === 'email') {
        payload.email = adminFormData.email.trim() || null;
      } else if (field === 'password') {
        if (!adminFormData.password.trim()) {
          setError('Please enter a new password.');
          setSaving(false);
          return;
        }
        if (adminFormData.password !== confirmPassword) {
          setError('Passwords do not match. Please verify both fields.');
          setSaving(false);
          return;
        }
        payload.password = adminFormData.password.trim();
      }

      if (Object.keys(payload).length === 0) {
        setError('Please enter a value to update.');
        setSaving(false);
        return;
      }

      await updateUser(currentUser.user_id, payload);
      
      // Update the current user in the parent component
      const updatedUser = { ...currentUser, ...payload };
      if (onUserUpdate) {
        onUserUpdate(updatedUser);
      }

      setSuccess(`${field.charAt(0).toUpperCase() + field.slice(1)} updated successfully.`);
      setAdminEditMode({ ...adminEditMode, [field]: false });
      
      // Clear password fields and reset visibility after successful update
      if (field === 'password') {
        setAdminFormData({ ...adminFormData, password: '' });
        setConfirmPassword('');
        setShowPassword(false);
        setShowConfirmPassword(false);
        setCurrentPassword(payload.password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update.');
    } finally {
      setSaving(false);
    }
  };

  const handleAdminCancel = (field) => {
    setAdminEditMode({ ...adminEditMode, [field]: false });
    if (field === 'password') {
      setAdminFormData({ ...adminFormData, password: '' });
      setConfirmPassword('');
      setShowPassword(false);
      setShowConfirmPassword(false);
    }
  };

  // Admin personalized settings view
  if (isAdmin) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-on-surface-variant/60">Settings</p>
          <h2 className="mt-2 text-headline-xl font-headline-xl text-on-surface">Personal Settings</h2>
          <p className="mt-1 max-w-2xl text-body-md text-on-surface-variant">
            Update your personal account information.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <CheckCircle2 size={18} />
            <span>{success}</span>
          </div>
        )}

        {/* Username Box */}
        <div className="glass-panel rounded-2xl p-6 space-y-3">
          <div>
            <span className="block text-xs font-extrabold uppercase tracking-[0.2em] text-on-surface-variant">Username</span>
            <span className="block text-xs text-on-surface-variant/50 mt-1">Customize your personal information.</span>
          </div>
          <input
            type="text"
            value={adminFormData.username}
            onChange={(e) => adminEditMode.username && setAdminFormData({ ...adminFormData, username: e.target.value })}
            readOnly={!adminEditMode.username}
            className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition ${
              adminEditMode.username
                ? 'border-primary bg-white text-on-surface focus:ring-4 focus:ring-primary/10'
                : 'border-outline-variant bg-slate-50 text-on-surface cursor-text'
            }`}
          />
          <div className="flex justify-end gap-2 pt-1">
            {!adminEditMode.username ? (
              <button
                type="button"
                onClick={() => setAdminEditMode({ ...adminEditMode, username: true })}
                className="rounded-lg border border-outline-variant bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
              >
                Change
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleAdminSave('username')}
                  disabled={saving}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setAdminEditMode({ ...adminEditMode, username: false })}
                  disabled={saving}
                  className="rounded-lg border border-outline-variant bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}
            </div>
          </div>

          {/* Email Box */}
          <div className="glass-panel rounded-2xl p-6 space-y-3">
            <div>
              <span className="block text-xs font-extrabold uppercase tracking-[0.2em] text-on-surface-variant">Email</span>
              <span className="block text-xs text-on-surface-variant/50 mt-1">Customize your personal information.</span>
            </div>
            <input
              type="email"
              value={adminFormData.email}
              onChange={(e) => adminEditMode.email && setAdminFormData({ ...adminFormData, email: e.target.value })}
              readOnly={!adminEditMode.email}
              className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition ${
                adminEditMode.email
                  ? 'border-primary bg-white text-on-surface focus:ring-4 focus:ring-primary/10'
                  : 'border-outline-variant bg-slate-50 text-on-surface cursor-text'
              }`}
            />
            <div className="flex justify-end gap-2 pt-1">
              {!adminEditMode.email ? (
                <button
                  type="button"
                  onClick={() => setAdminEditMode({ ...adminEditMode, email: true })}
                  className="rounded-lg border border-outline-variant bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
                >
                  Change
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleAdminSave('email')}
                    disabled={saving}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminEditMode({ ...adminEditMode, email: false })}
                    disabled={saving}
                    className="rounded-lg border border-outline-variant bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Password Box */}
          <div className="glass-panel rounded-2xl p-6 space-y-3">
            <div>
              <span className="block text-xs font-extrabold uppercase tracking-[0.2em] text-on-surface-variant">Password</span>
              <span className="block text-xs text-on-surface-variant/50 mt-1">Customize your personal information.</span>
            </div>
            
            {/* Current Password Display / New Password Input */}
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={adminEditMode.password ? adminFormData.password : displayPassword}
                onChange={(e) => adminEditMode.password && setAdminFormData({ ...adminFormData, password: e.target.value })}
                placeholder={adminEditMode.password ? 'Enter new password' : ''}
                readOnly={!adminEditMode.password}
                className={`w-full rounded-2xl border px-4 py-3 pr-10 text-sm outline-none transition ${
                  adminEditMode.password
                    ? 'border-primary bg-white text-on-surface focus:ring-4 focus:ring-primary/10'
                    : 'border-outline-variant bg-slate-50 text-on-surface cursor-text'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {/* Confirm Password Field - Only in Edit Mode */}
            {adminEditMode.password && (
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className={`w-full rounded-2xl border px-4 py-3 pr-10 text-sm outline-none transition border-primary bg-white text-on-surface focus:ring-4 focus:ring-primary/10`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            )}

            {/* Buttons - Below the inputs, right-aligned */}
            <div className="flex justify-end gap-2 pt-1">
              {!adminEditMode.password ? (
                <button
                  type="button"
                  onClick={() => {
                    setAdminEditMode({ ...adminEditMode, password: true });
                    setAdminFormData({ ...adminFormData, password: '' });
                    setConfirmPassword('');
                    setShowPassword(false);
                    setShowConfirmPassword(false);
                  }}
                  className="rounded-lg border border-outline-variant bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
                >
                  Change Password
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleAdminSave('password')}
                    disabled={saving}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdminCancel('password')}
                    disabled={saving}
                    className="rounded-lg border border-outline-variant bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
      </div>
    );
  }

  // Super-admin full user administration view
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-on-surface-variant/60">Settings</p>
          <h2 className="mt-2 text-headline-xl font-headline-xl text-on-surface">User Administration</h2>
          <p className="mt-1 max-w-2xl text-body-md text-on-surface-variant">
            Manage app users, update credentials, change roles, and deactivate accounts from one place.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
        >
          <UserPlus size={18} />
          Add User
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-3 text-on-surface-variant">
            <Users size={18} />
            <span className="text-xs font-bold uppercase tracking-[0.22em]">Total Users</span>
          </div>
          <p className="mt-3 text-numeric-lg font-numeric-lg text-on-surface">{stats.total}</p>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-3 text-on-surface-variant">
            <CheckCircle2 size={18} />
            <span className="text-xs font-bold uppercase tracking-[0.22em]">Active</span>
          </div>
          <p className="mt-3 text-numeric-lg font-numeric-lg text-on-surface">{stats.active}</p>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-3 text-on-surface-variant">
            <Shield size={18} />
            <span className="text-xs font-bold uppercase tracking-[0.22em]">Admins</span>
          </div>
          <p className="mt-3 text-numeric-lg font-numeric-lg text-on-surface">{stats.admins}</p>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search username, email, role, or status"
              className="w-full rounded-2xl border border-outline-variant bg-white/80 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {['', 'active', 'inactive'].map((status) => (
              <button
                type="button"
                key={status || 'all'}
                onClick={() => setStatusFilter(status)}
                className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] transition-colors ${
                  statusFilter === status ? 'bg-primary text-white' : 'bg-white/80 text-on-surface-variant hover:bg-white'
                }`}
              >
                {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'All'}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <CheckCircle2 size={18} />
            <span>{success}</span>
          </div>
        )}

        <div className="mt-6 overflow-hidden rounded-2xl border border-white/60 bg-white/80">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50/80 text-xs font-bold uppercase tracking-[0.22em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Username</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white/70">
                {loading ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-on-surface-variant" colSpan={6}>
                      Loading users...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-on-surface-variant" colSpan={6}>
                      No users found.
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.user_id} className="transition-colors hover:bg-slate-50/80">
                      <td className="px-4 py-4 font-semibold text-on-surface">{user.username}</td>
                      <td className="px-4 py-4 text-on-surface-variant">{user.email || '—'}</td>
                      <td className="px-4 py-4 text-on-surface-variant">{user.role || 'admin'}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.2em] ${String(user.status || '').toLowerCase() === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                          {user.status || 'inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs text-on-surface-variant">
                        {user.updated_at ? new Date(user.updated_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(user)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
                          >
                            <Edit3 size={14} />
                            Edit
                          </button>
                          {user.role !== 'super-admin' && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(user)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100"
                            >
                              <Trash2 size={14} />
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {(showAddModal || editingUser) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-white/60 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">
                  {showAddModal ? 'Create user' : 'Edit user'}
                </p>
                <h3 className="mt-2 text-2xl font-bold text-on-surface">
                  {showAddModal ? 'Add a new account' : 'Update user credentials'}
                </h3>
              </div>
              <button type="button" onClick={closeModals} className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-slate-100">
                <AlertCircle size={18} />
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="space-y-2 md:col-span-1">
                <span className="block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">Username</span>
                <input
                  value={formData.username}
                  onChange={(event) => setFormData({ ...formData, username: event.target.value })}
                  className="w-full rounded-2xl border border-outline-variant bg-white px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </label>
              <label className="space-y-2 md:col-span-1">
                <span className="block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">Email</span>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(event) => setFormData({ ...formData, email: event.target.value })}
                  className="w-full rounded-2xl border border-outline-variant bg-white px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </label>
              <label className="space-y-2">
                <span className="block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">Role</span>
                <select
                  value={formData.role}
                  onChange={(event) => setFormData({ ...formData, role: event.target.value })}
                  className="w-full rounded-2xl border border-outline-variant bg-white px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">Status</span>
                <select
                  value={formData.status}
                  onChange={(event) => setFormData({ ...formData, status: event.target.value })}
                  className="w-full rounded-2xl border border-outline-variant bg-white px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">
                  {showAddModal ? 'Password' : 'New Password'}
                </span>
                <div className="relative">
                  <input
                    type={showModalPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(event) => setFormData({ ...formData, password: event.target.value })}
                    placeholder={showAddModal ? 'Required' : 'Leave blank to keep current password'}
                    className="w-full rounded-2xl border border-outline-variant bg-white px-4 py-3 pr-10 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowModalPassword(!showModalPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    {showModalPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {!showAddModal && (
                  <p className="text-xs text-on-surface-variant">
                    Only enter a new password if you want to change credentials.
                  </p>
                )}
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">
                  {showAddModal ? 'Confirm Password' : 'Confirm New Password'}
                </span>
                <div className="relative">
                  <input
                    type={showModalConfirmPassword ? 'text' : 'password'}
                    value={modalConfirmPassword}
                    onChange={(event) => setModalConfirmPassword(event.target.value)}
                    placeholder={showAddModal ? 'Required' : 'Confirm new password'}
                    className="w-full rounded-2xl border border-outline-variant bg-white px-4 py-3 pr-10 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowModalConfirmPassword(!showModalConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    {showModalConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
            </div>

            {modalError && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {modalError}
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeModals}
                className="rounded-xl border border-outline-variant bg-white px-4 py-2.5 text-sm font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/60 bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-50 p-2 text-red-600">
                <Trash2 size={18} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-on-surface">Delete user</h3>
                <p className="mt-1 text-sm text-on-surface-variant">
                  Delete {deleteTarget.username}? This cannot be undone.
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-outline-variant bg-white px-4 py-2.5 text-sm font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
