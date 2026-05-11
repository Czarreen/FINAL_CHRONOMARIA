import { useEffect, useState } from 'react';
import {
  Trash2,
  Edit2,
  Search,
  Check,
  X,
  AlertCircle,
  Shield,
  Mail,
  User,
  Download,
  Calendar,
} from 'lucide-react';
import {
  fetchUsers,
  createUser,
  updateUser,
  updateUserStatus,
  deleteUser,
  updateUserPassword,
} from '../services/usersApi.js';
import {
  fetchAuditLogs,
  fetchAuditLogById,
  exportAuditLogs,
  clearOldAuditLogs,
  createAuditLog,
  buildChangeSummary,
} from '../services/auditLogsApi.js';

export default function SettingsView() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const userRole = user.role || 'staff';
  const isSuperAdmin = userRole === 'super-admin';

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [updateError, setUpdateError] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargetUser, setDeleteTargetUser] = useState(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [newUser, setNewUser] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'staff',
    status: 'active',
  });

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState(null);
  const [editingData, setEditingData] = useState({
    username: '',
    email: '',
    role: 'staff',
    status: 'active',
    password: '',
    confirmPassword: '',
  });

  // Audit Logs state
  const [activeTab, setActiveTab] = useState(isSuperAdmin ? 'users' : 'users'); // Only show users by default
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState(null);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditRoleFilter, setAuditRoleFilter] = useState('');
  const [auditStartDate, setAuditStartDate] = useState('');
  const [auditEndDate, setAuditEndDate] = useState('');
  const [showAuditDetailsModal, setShowAuditDetailsModal] = useState(false);
  const [selectedAuditLog, setSelectedAuditLog] = useState(null);
  const [exportingLogs, setExportingLogs] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);

  useEffect(() => {
    loadUsers();
  }, [page, search]);

  useEffect(() => {
    if (activeTab === 'audit-logs') {
      loadAuditLogs();
    }
  }, [auditPage, auditSearch, auditRoleFilter, auditStartDate, auditEndDate, activeTab]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchUsers({ page, limit, search });
      setUsers(data.rows);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusToggle = async (userId, currentStatus) => {
    try {
      setUpdatingStatus(userId);
      setUpdateError(null);
      const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
      await updateUserStatus(userId, newStatus);
      await loadUsers();
      createAuditLog({ action: `Set user status to ${newStatus}`, module: 'Users', description: `Changed user #${userId} status to ${newStatus}` });
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setUpdatingStatus(null);
    }
  };

  const handleDeleteClick = (user) => {
    setDeleteTargetUser(user);
    setDeleteError(null);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetUser) return;

    try {
      setDeletingUser(deleteTargetUser.user_id);
      setDeleteError(null);
      await deleteUser(deleteTargetUser.user_id);
      setShowDeleteModal(false);
      createAuditLog({ action: 'Deleted user', module: 'Users', description: `Deleted user "${deleteTargetUser.username}"`, changesBefore: deleteTargetUser });
      setDeleteTargetUser(null);
      await loadUsers();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeletingUser(null);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setCreateError(null);

    // Validation
    if (!newUser.username.trim()) {
      setCreateError('Username is required');
      return;
    }
    if (!newUser.email.trim()) {
      setCreateError('Email is required');
      return;
    }
    if (!newUser.password) {
      setCreateError('Password is required');
      return;
    }
    if (newUser.password !== newUser.confirmPassword) {
      setCreateError('Passwords do not match');
      return;
    }
    if (newUser.password.length < 6) {
      setCreateError('Password must be at least 6 characters');
      return;
    }

    try {
      setCreatingUser(true);
      const userData = {
        username: newUser.username.trim(),
        email: newUser.email.trim(),
        password: newUser.password,
        role: newUser.role,
        status: newUser.status,
      };
      const createdUser = await createUser(userData);
      createAuditLog({ action: 'Created user', module: 'Users', description: `Added user "${userData.username}" with role ${userData.role}`, changesAfter: createdUser });

      // Reset form
      setNewUser({
        username: '',
        email: '',
        password: '',
        confirmPassword: '',
        role: 'staff',
        status: 'active',
      });
      setShowCreateModal(false);
      await loadUsers();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreatingUser(false);
    }
  };

  const handleEditUser = (user) => {
    setEditingUser(user);
    setEditingData({
      username: user.username || '',
      email: user.email || '',
      role: user.role || 'staff',
      status: user.status || 'active',
      password: '',
      confirmPassword: '',
    });
    setEditError(null);
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setEditError(null);

    if (!editingUser) {
      setEditError('No user selected for editing');
      return;
    }

    if (!editingData.username.trim()) {
      setEditError('Username is required');
      return;
    }

    if (!editingData.email.trim()) {
      setEditError('Email is required');
      return;
    }

    // Validate password if one was entered
    if (editingData.password) {
      if (editingData.password.length < 6) {
        setEditError('Password must be at least 6 characters');
        return;
      }
      if (editingData.password !== editingData.confirmPassword) {
        setEditError('Passwords do not match');
        return;
      }
    }

    try {
      setSavingEdit(true);

      // Update user data (username, email, role, status)
      const updatePayload = {
        username: editingData.username,
        email: editingData.email,
        role: editingData.role,
        status: editingData.status,
      };

      await updateUser(editingUser.user_id, updatePayload);

      // If a new password was entered, update it separately
      if (editingData.password) {
        await updateUserPassword(editingUser.user_id, editingData.password);
      }

      const passwordChanged = !!editingData.password;
      const changeSummary = buildChangeSummary(editingUser, updatePayload, { username: 'Username', email: 'Email', role: 'Role', status: 'Status' });
      const fullSummary = passwordChanged ? `${changeSummary}; Password changed` : changeSummary;
      createAuditLog({ action: 'Updated user', module: 'Users', description: `Updated user "${editingUser.username}": ${fullSummary}` });
      setShowEditModal(false);
      setEditingUser(null);
      await loadUsers();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setSavingEdit(false);
    }
  };

  const loadAuditLogs = async () => {
    try {
      setAuditLoading(true);
      setAuditError(null);
      const data = await fetchAuditLogs({
        page: auditPage,
        limit,
        search: auditSearch,
        role: auditRoleFilter,
        startDate: auditStartDate,
        endDate: auditEndDate,
      });
      setAuditLogs(data.rows);
      setAuditTotal(data.total);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Failed to load audit logs');
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleViewAuditDetails = async (log) => {
    try {
      const detailedLog = await fetchAuditLogById(log.id);
      setSelectedAuditLog(detailedLog);
      setShowAuditDetailsModal(true);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Failed to load log details');
    }
  };

  const handleExportLogs = async () => {
    try {
      setExportingLogs(true);
      const blob = await exportAuditLogs({ startDate: auditStartDate, endDate: auditEndDate });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Failed to export logs');
    } finally {
      setExportingLogs(false);
    }
  };

  const handleClearOldLogs = async () => {
    if (!window.confirm('Are you sure you want to clear logs older than 90 days? This action cannot be undone.')) {
      return;
    }

    try {
      setClearingLogs(true);
      await clearOldAuditLogs(90);
      await loadAuditLogs();
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Failed to clear logs');
    } finally {
      setClearingLogs(false);
    }
  };

  const totalPages = Math.ceil(total / limit);
  const auditTotalPages = Math.ceil(auditTotal / limit);

  return (
    <div className="space-y-gutter animate-in fade-in duration-500">
      {/* Header */}
      <div className="mb-2 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="text-headline-xl font-headline-xl text-on-surface">Settings</h2>
          <p className="mt-1 text-body-md text-on-surface-variant">Manage system users and access control</p>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-2 border-b border-outline">
        <button
          onClick={() => {
            setActiveTab('users');
            setAuditPage(1);
          }}
          className={`px-6 py-3 text-sm font-medium transition-colors ${
            activeTab === 'users'
              ? 'border-b-2 border-primary text-primary'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          Current Users
        </button>
        {isSuperAdmin && (
          <button
            onClick={() => {
              setActiveTab('audit-logs');
              setAuditPage(1);
            }}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === 'audit-logs'
                ? 'border-b-2 border-primary text-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Audit Logs
          </button>
        )}
      </div>

      <>
      {/* Current Users Section */}
      {activeTab === 'users' && (
      <div className="glass-panel space-y-6 p-8">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h3 className="text-headline-md font-headline-md text-on-surface">Current Users</h3>
            <p className="mt-1 text-body-sm text-on-surface-variant">Manage existing system users</p>
          </div>
          <button
            onClick={() => {
              setCreateError(null);
              setNewUser({
                username: '',
                email: '',
                password: '',
                confirmPassword: '',
                role: 'staff',
                status: 'active',
              });
              setShowCreateModal(true);
            }}
            className="btn-primary flex items-center gap-2 self-start md:self-auto"
          >
            <User size={18} />
            <span>Add User</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" size={18} />
          <input
            type="text"
            placeholder="Search by name, username, or email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-outline bg-surface pl-12 pr-4 py-3 text-sm transition-colors placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Error Messages */}
        {error && (
          <div className="flex items-center gap-3 rounded-lg bg-error-container p-4 text-error">
            <AlertCircle size={18} className="flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}
        {updateError && (
          <div className="flex items-center gap-3 rounded-lg bg-error-container p-4 text-error">
            <AlertCircle size={18} className="flex-shrink-0" />
            <span className="text-sm">{updateError}</span>
          </div>
        )}
        {deleteError && (
          <div className="flex items-center gap-3 rounded-lg bg-error-container p-4 text-error">
            <AlertCircle size={18} className="flex-shrink-0" />
            <span className="text-sm">{deleteError}</span>
          </div>
        )}

        {/* Users Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-outline border-t-primary" />
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg bg-surface py-12">
            <Shield size={48} className="mb-4 text-on-surface-variant/50" />
            <p className="text-on-surface-variant">No users found</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-outline">
            <table className="w-full">
              <thead>
                <tr className="border-b border-outline bg-surface-dim">
                  <th className="px-6 py-4 text-left text-label-md font-semibold text-on-surface">Username</th>
                  <th className="px-6 py-4 text-left text-label-md font-semibold text-on-surface">Email</th>
                  <th className="px-6 py-4 text-left text-label-md font-semibold text-on-surface">Role</th>
                  <th className="px-6 py-4 text-left text-label-md font-semibold text-on-surface">Status</th>
                  <th className="px-6 py-4 text-center text-label-md font-semibold text-on-surface">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user, index) => (
                  <tr
                    key={user.user_id}
                    className={`border-b border-outline transition-colors hover:bg-surface-dim ${
                      index % 2 === 0 ? 'bg-surface' : 'bg-surface-dim/50'
                    }`}
                  >
                    <td className="px-6 py-4 text-body-sm text-on-surface-variant">{user.username}</td>
                    <td className="px-6 py-4 text-body-sm text-on-surface-variant">{user.email || '—'}</td>
                    <td className="px-6 py-4">
                      <span className="text-label-sm font-medium text-on-surface capitalize">
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleStatusToggle(user.user_id, user.status)}
                        disabled={updatingStatus === user.user_id}
                        className={`inline-flex items-center rounded-full px-3 py-1 text-label-sm font-medium capitalize transition-colors ${
                          user.status === 'active'
                            ? 'bg-green-100/50 text-green-700 hover:bg-green-100'
                            : 'bg-red-100/50 text-red-700 hover:bg-red-100'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {updatingStatus === user.user_id ? (
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : user.status === 'active' ? (
                          <>
                            <Check size={14} className="mr-1" />
                            Active
                          </>
                        ) : (
                          <>
                            <X size={14} className="mr-1" />
                            Inactive
                          </>
                        )}
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2">
                        {!(user.role === 'super-admin' && !isSuperAdmin) && (
                          <button
                            onClick={() => handleEditUser(user)}
                            className="rounded-lg p-2 text-slate-400 transition-all hover:bg-white hover:text-primary"
                            title="Edit user"
                          >
                            <Edit2 size={16} />
                          </button>
                        )}
                        {!(user.role === 'super-admin' && !isSuperAdmin) && (
                          <button
                            onClick={() => handleDeleteClick(user)}
                            className="rounded-lg p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-body-sm text-on-surface-variant">
              Page {page} of {totalPages} • Showing {users.length} of {total} users
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="rounded-lg border border-outline px-4 py-2 text-sm font-medium text-on-surface transition-colors hover:bg-surface-dim disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-outline px-4 py-2 text-sm font-medium text-on-surface transition-colors hover:bg-surface-dim disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Audit Logs Section */}
      {isSuperAdmin && activeTab === 'audit-logs' && (
        <div className="glass-panel space-y-6 p-8">
          {/* Header */}
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <h3 className="text-headline-md font-headline-md text-on-surface">Audit Logs</h3>
              <p className="mt-1 text-body-sm text-on-surface-variant">System activity and user action history</p>
            </div>
            <div className="flex items-center gap-3 self-start md:self-auto">
              <button
                onClick={handleExportLogs}
                disabled={exportingLogs}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download size={18} />
                <span>{exportingLogs ? 'Exporting...' : 'Export Logs'}</span>
              </button>
              <button
                onClick={handleClearOldLogs}
                disabled={clearingLogs}
                className="flex items-center gap-2 rounded-lg border border-error px-4 py-2 text-sm font-medium text-error transition-colors hover:bg-error-container disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 size={18} />
                <span>{clearingLogs ? 'Clearing...' : 'Clear Old Logs'}</span>
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" size={18} />
            <input
              type="text"
              placeholder="Search logs by user, action, or module..."
              value={auditSearch}
              onChange={(e) => {
                setAuditSearch(e.target.value);
                setAuditPage(1);
              }}
              className="w-full rounded-lg border border-outline bg-surface pl-12 pr-4 py-3 text-sm transition-colors placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <select
              value={auditRoleFilter}
              onChange={(e) => {
                setAuditRoleFilter(e.target.value);
                setAuditPage(1);
              }}
              className="rounded-lg border border-outline bg-surface px-3 py-2 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All Users</option>
              <option value="super-admin">Super Admin</option>
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
            </select>

            <input
              type="date"
              value={auditStartDate}
              onChange={(e) => {
                setAuditStartDate(e.target.value);
                setAuditPage(1);
              }}
              className="rounded-lg border border-outline bg-surface px-3 py-2 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Error Messages */}
          {auditError && (
            <div className="flex items-center gap-3 rounded-lg bg-error-container p-4 text-error">
              <AlertCircle size={18} className="flex-shrink-0" />
              <span className="text-sm">{auditError}</span>
            </div>
          )}

          {/* Audit Logs Table */}
          {auditLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-outline border-t-primary" />
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg bg-surface py-12">
              <Shield size={48} className="mb-4 text-on-surface-variant/50" />
              <p className="text-on-surface-variant">No audit logs found</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-outline">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-outline bg-surface-dim">
                    <th className="px-6 py-4 text-left text-label-md font-semibold text-on-surface">Time</th>
                    <th className="px-6 py-4 text-left text-label-md font-semibold text-on-surface">User</th>
                    <th className="px-6 py-4 text-left text-label-md font-semibold text-on-surface">Role</th>
                    <th className="px-6 py-4 text-left text-label-md font-semibold text-on-surface">Change</th>
                    <th className="px-6 py-4 text-left text-label-md font-semibold text-on-surface">Module Affected</th>
                    <th className="px-6 py-4 text-left text-label-md font-semibold text-on-surface">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log, index) => (
                    <tr
                      key={log.id}
                      className={`border-b border-outline transition-colors hover:bg-surface-dim ${
                        index % 2 === 0 ? 'bg-surface' : 'bg-surface-dim/50'
                      }`}
                    >
                      <td className="px-6 py-4 text-body-sm text-on-surface whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-body-sm text-on-surface">{log.username || '—'}</td>
                      <td className="px-6 py-4 text-body-sm text-on-surface-variant capitalize">{log.role || '—'}</td>
                      <td className="px-6 py-4 text-body-sm text-on-surface max-w-xs truncate">{log.action || '—'}</td>
                      <td className="px-6 py-4 text-body-sm text-on-surface-variant">{log.module || '—'}</td>
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() => handleViewAuditDetails(log)}
                          className="text-primary text-sm font-medium hover:underline"
                        >
                          Show more
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {auditTotalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-body-sm text-on-surface-variant">
                Page {auditPage} of {auditTotalPages} • Showing {auditLogs.length} of {auditTotal} logs
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setAuditPage(Math.max(1, auditPage - 1))}
                  disabled={auditPage === 1}
                  className="rounded-lg border border-outline px-4 py-2 text-sm font-medium text-on-surface transition-colors hover:bg-surface-dim disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setAuditPage(Math.min(auditTotalPages, auditPage + 1))}
                  disabled={auditPage === auditTotalPages}
                  className="rounded-lg border border-outline px-4 py-2 text-sm font-medium text-on-surface transition-colors hover:bg-surface-dim disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      </>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-lg">
            <h3 className="text-headline-md font-headline-md text-on-surface mb-6">Create New User</h3>

            {createError && (
              <div className="mb-4 flex items-center gap-3 rounded-lg bg-error-container p-4 text-error">
                <AlertCircle size={18} className="flex-shrink-0" />
                <span className="text-sm">{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-6">
              <div className="grid grid-cols-2 gap-8">
                {/* Column 1 */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-label-md font-semibold text-on-surface mb-2">Username</label>
                    <input
                      type="text"
                      value={newUser.username}
                      onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                      placeholder="Enter username"
                      className="w-full rounded-lg border border-outline bg-surface px-4 py-3 text-sm transition-colors placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  <div>
                    <label className="block text-label-md font-semibold text-on-surface mb-2">Email</label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                      placeholder="Enter email"
                      className="w-full rounded-lg border border-outline bg-surface px-4 py-3 text-sm transition-colors placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  <div>
                    <label className="block text-label-md font-semibold text-on-surface mb-2">Password</label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={newUser.password}
                      onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                      placeholder="Enter password (min 6 characters)"
                      className="w-full rounded-lg border border-outline bg-surface px-4 py-3 text-sm transition-colors placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>

                {/* Column 2 */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-label-md font-semibold text-on-surface mb-2">Confirm Password</label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={newUser.confirmPassword}
                      onChange={(e) => setNewUser({ ...newUser, confirmPassword: e.target.value })}
                      placeholder="Confirm password"
                      className="w-full rounded-lg border border-outline bg-surface px-4 py-3 text-sm transition-colors placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  <div>
                    <label className="block text-label-md font-semibold text-on-surface mb-2">Role</label>
                    <select
                      value={newUser.role}
                      onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                      className="w-full rounded-lg border border-outline bg-surface px-4 py-3 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                      {isSuperAdmin && <option value="super-admin">Super Admin</option>}
                    </select>
                  </div>

                  <div>
                    <label className="block text-label-md font-semibold text-on-surface mb-2">Status</label>
                    <select
                      value={newUser.status}
                      onChange={(e) => setNewUser({ ...newUser, status: e.target.value })}
                      className="w-full rounded-lg border border-outline bg-surface px-4 py-3 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Buttons - Centered between columns */}
              <div className="flex justify-center gap-3 pt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateError(null);
                    setNewUser({
                      username: '',
                      email: '',
                      password: '',
                      confirmPassword: '',
                      role: 'staff',
                      status: 'active',
                    });
                  }}
                  className="rounded-lg border border-outline px-6 py-3 text-sm font-medium text-on-surface transition-colors hover:bg-surface-dim"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingUser}
                  className="btn-primary px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creatingUser ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-lg">
            <h3 className="text-headline-md font-headline-md text-on-surface mb-6">Edit User</h3>

            {editError && (
              <div className="mb-4 flex items-center gap-3 rounded-lg bg-error-container p-4 text-error">
                <AlertCircle size={18} className="flex-shrink-0" />
                <span className="text-sm">{editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-6">
              <div className="grid grid-cols-2 gap-8">
                {/* Column 1 */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-label-md font-semibold text-on-surface mb-2">Username</label>
                    <input
                      type="text"
                      value={editingData.username}
                      onChange={(e) => setEditingData({ ...editingData, username: e.target.value })}
                      placeholder="Enter username"
                      className="w-full rounded-lg border border-outline bg-surface px-4 py-3 text-sm transition-colors placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  <div>
                    <label className="block text-label-md font-semibold text-on-surface mb-2">Email</label>
                    <input
                      type="email"
                      value={editingData.email}
                      onChange={(e) => setEditingData({ ...editingData, email: e.target.value })}
                      placeholder="Enter email"
                      className="w-full rounded-lg border border-outline bg-surface px-4 py-3 text-sm transition-colors placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>

                {/* Column 2 */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-label-md font-semibold text-on-surface mb-2">Role</label>
                    <select
                      value={editingData.role}
                      onChange={(e) => setEditingData({ ...editingData, role: e.target.value })}
                      className="w-full rounded-lg border border-outline bg-surface px-4 py-3 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                      {isSuperAdmin && <option value="super-admin">Super Admin</option>}
                    </select>
                  </div>

                  <div>
                    <label className="block text-label-md font-semibold text-on-surface mb-2">Status</label>
                    <select
                      value={editingData.status}
                      onChange={(e) => setEditingData({ ...editingData, status: e.target.value })}
                      className="w-full rounded-lg border border-outline bg-surface px-4 py-3 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Password Section - shown when editing a super-admin or admin user */}
              {(editingData.role === 'super-admin' || editingData.role === 'admin') && (
                <div>
                  <div className="mb-4 rounded-lg bg-surface-dim p-3">
                    <p className="text-sm font-medium text-on-surface">Change Password (Optional)</p>
                    <p className="text-xs text-on-surface-variant mt-1">Leave blank to keep current password</p>
                  </div>
                  <div className="grid grid-cols-2 gap-8">
                    <div>
                      <label className="block text-label-md font-semibold text-on-surface mb-2">New Password</label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={editingData.password}
                        onChange={(e) => setEditingData({ ...editingData, password: e.target.value })}
                        placeholder="Enter new password (min 6 characters)"
                        className="w-full rounded-lg border border-outline bg-surface px-4 py-3 text-sm transition-colors placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <div>
                      <label className="block text-label-md font-semibold text-on-surface mb-2">Confirm Password</label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={editingData.confirmPassword}
                        onChange={(e) => setEditingData({ ...editingData, confirmPassword: e.target.value })}
                        placeholder="Confirm new password"
                        className="w-full rounded-lg border border-outline bg-surface px-4 py-3 text-sm transition-colors placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Buttons - Centered between columns */}
              <div className="flex justify-center gap-3 pt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingUser(null);
                    setEditError(null);
                  }}
                  className="rounded-lg border border-outline px-6 py-3 text-sm font-medium text-on-surface transition-colors hover:bg-surface-dim"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="btn-primary px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {showDeleteModal && deleteTargetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative">
            <div className="glass-panel w-full max-w-sm animate-in fade-in duration-300 rounded-lg shadow-xl">
              <div className="flex items-center justify-between border-b border-white/20 p-6">
                <div>
                  <h3 className="text-lg font-bold text-on-surface">Delete User</h3>
                  <p className="mt-1 text-sm text-on-surface-variant">Once you delete this user you cannot bring them back.</p>
                </div>
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeleteTargetUser(null);
                    setDeleteError(null);
                  }}
                  className="rounded p-1 text-slate-400 hover:bg-white/20 hover:text-on-surface"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4 p-6">
                {deleteError && <p className="rounded bg-red-100 p-3 text-sm text-red-700">{deleteError}</p>}
                <p className="text-on-surface">
                  Are you sure you want to delete <span className="font-bold">{deleteTargetUser.username}</span>? This action cannot be undone.
                </p>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteModal(false);
                      setDeleteTargetUser(null);
                      setDeleteError(null);
                    }}
                    disabled={!!deletingUser}
                    className="flex-1 rounded-md border border-white/30 bg-white/60 px-4 py-2 font-medium text-on-surface transition-colors hover:bg-white/80 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDelete}
                    disabled={!!deletingUser}
                    className="flex-1 rounded-md bg-red-500 px-4 py-2 font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                  >
                    {deletingUser ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Audit Log Details Modal */}
      {showAuditDetailsModal && selectedAuditLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-lg max-h-[90vh] overflow-y-auto">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-headline-md font-headline-md text-on-surface">Activity Details</h3>
              <button
                onClick={() => {
                  setShowAuditDetailsModal(false);
                  setSelectedAuditLog(null);
                }}
                className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-dim"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6">
              {/* Main Details */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-label-sm font-semibold text-on-surface-variant">Timestamp</p>
                    <p className="mt-1 text-body-md text-on-surface">
                      {new Date(selectedAuditLog.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-label-sm font-semibold text-on-surface-variant">User</p>
                    <p className="mt-1 text-body-md text-on-surface">{selectedAuditLog.username || '—'}</p>
                  </div>
                  <div>
                    <p className="text-label-sm font-semibold text-on-surface-variant">Role</p>
                    <p className="mt-1 text-body-md text-on-surface capitalize">{selectedAuditLog.role || '—'}</p>
                  </div>
                  <div>
                    <p className="text-label-sm font-semibold text-on-surface-variant">Module</p>
                    <p className="mt-1 text-body-md text-on-surface">{selectedAuditLog.module || '—'}</p>
                  </div>
                </div>

                <div>
                  <p className="text-label-sm font-semibold text-on-surface-variant">Action</p>
                  <p className="mt-1 text-body-md text-on-surface">{selectedAuditLog.action || '—'}</p>
                </div>

                <div>
                  <p className="text-label-sm font-semibold text-on-surface-variant">Status</p>
                  <p className="mt-1">
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-label-sm font-medium ${
                        selectedAuditLog.status === 'success'
                          ? 'bg-green-100/50 text-green-700'
                          : selectedAuditLog.status === 'failed'
                          ? 'bg-red-100/50 text-red-700'
                          : 'bg-yellow-100/50 text-yellow-700'
                      }`}
                    >
                      {selectedAuditLog.status === 'success' && <Check size={14} className="mr-1" />}
                      {selectedAuditLog.status === 'failed' && <X size={14} className="mr-1" />}
                      {selectedAuditLog.status === 'warning' && <AlertCircle size={14} className="mr-1" />}
                      {String(selectedAuditLog.status).charAt(0).toUpperCase() + String(selectedAuditLog.status).slice(1)}
                    </span>
                  </p>
                </div>
              </div>

              {/* Description */}
              {selectedAuditLog.description && (
                <div className="border-t border-outline pt-4">
                  <p className="text-label-sm font-semibold text-on-surface-variant">Description</p>
                  <p className="mt-2 text-body-md text-on-surface">{selectedAuditLog.description}</p>
                </div>
              )}


              {/* Device Info */}
              <div className="border-t border-outline pt-4">
                <p className="text-label-sm font-semibold text-on-surface-variant">Device Information</p>
                <div className="mt-2 space-y-2">
                  <p className="text-body-sm text-on-surface">
                    <span className="font-medium">IP Address:</span> {selectedAuditLog.ip_address || '—'}
                  </p>
                  {selectedAuditLog.user_agent && (
                    <p className="text-body-sm text-on-surface-variant break-words">
                      <span className="font-medium">User Agent:</span> {selectedAuditLog.user_agent}
                    </p>
                  )}
                </div>
              </div>

              {/* Close Button */}
              <div className="flex justify-end pt-6">
                <button
                  onClick={() => {
                    setShowAuditDetailsModal(false);
                    setSelectedAuditLog(null);
                  }}
                  className="rounded-lg border border-outline px-6 py-3 text-sm font-medium text-on-surface transition-colors hover:bg-surface-dim"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
