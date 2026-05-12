import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Edit3, Search, Shield, Trash2, UserPlus, Users } from 'lucide-react';
import { createUser, deleteUser, fetchUsers, updateUser } from '../services/usersApi.js';

const EMPTY_USER = {
  username: '',
  email: '',
  password: '',
  role: 'staff',
  status: 'active',
};

const ROLE_OPTIONS = ['super-admin', 'admin', 'staff'];

export default function SettingsView() {
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
    loadUsers();
  }, [search, statusFilter]);

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
  };

  const openEditModal = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username || '',
      email: user.email || '',
      password: '',
      role: user.role || 'staff',
      status: user.status || 'active',
    });
    setShowAddModal(false);
    setError('');
  };

  const closeModals = () => {
    setShowAddModal(false);
    setEditingUser(null);
    setDeleteTarget(null);
    setFormData(EMPTY_USER);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');

      const payload = {
        username: formData.username.trim(),
        email: formData.email.trim() || null,
        role: formData.role.trim() || 'staff',
        status: formData.status.trim() || 'active',
      };

      if (showAddModal) {
        payload.password = formData.password;
        await createUser(payload);
        setSuccess('User created successfully.');
      } else if (editingUser) {
        if (formData.password.trim()) {
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
                      <td className="px-4 py-4 text-on-surface-variant">{user.role || 'staff'}</td>
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
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(user)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100"
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
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
                <input
                  type="password"
                  value={formData.password}
                  onChange={(event) => setFormData({ ...formData, password: event.target.value })}
                  placeholder={showAddModal ? 'Required' : 'Leave blank to keep current password'}
                  className="w-full rounded-2xl border border-outline-variant bg-white px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
                {!showAddModal && (
                  <p className="text-xs text-on-surface-variant">
                    Only enter a new password if you want to change credentials.
                  </p>
                )}
              </label>
            </div>

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

            <div className="mt-6 flex justify-end gap-3">
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