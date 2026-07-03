const BASE = import.meta.env.VITE_API_URL || ''

function getToken() {
  return localStorage.getItem('ownit_token')
}

async function request(path, options = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (res.status === 204) return null
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const api = {
  // Auth
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request('/api/auth/me'),
  getUsers: () => request('/api/auth/users'),
  createUser: (data) => request('/api/auth/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/api/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/api/auth/users/${id}`, { method: 'DELETE' }),

  // Staff
  getStaff: () => request('/api/staff'),
  createStaff: (data) => request('/api/staff', { method: 'POST', body: JSON.stringify(data) }),
  updateStaff: (id, data) => request(`/api/staff/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteStaff: (id) => request(`/api/staff/${id}`, { method: 'DELETE' }),

  // Sites
  getSites: () => request('/api/sites'),
  createSite: (data) => request('/api/sites', { method: 'POST', body: JSON.stringify(data) }),
  updateSite: (id, data) => request(`/api/sites/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSite: (id) => request(`/api/sites/${id}`, { method: 'DELETE' }),

  // Suppliers
  getSuppliers: () => request('/api/suppliers'),
  createSupplier: (data) => request('/api/suppliers', { method: 'POST', body: JSON.stringify(data) }),
  updateSupplier: (id, data) => request(`/api/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSupplier: (id) => request(`/api/suppliers/${id}`, { method: 'DELETE' }),

  // Invoices
  getInvoices: () => request('/api/invoices'),
  createInvoice: (data) => request('/api/invoices', { method: 'POST', body: JSON.stringify(data) }),
  updateInvoice: (id, data) => request(`/api/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteInvoice: (id) => request(`/api/invoices/${id}`, { method: 'DELETE' }),

  // Processes
  getProcesses: () => request('/api/processes'),
  getProcessRuns: () => request('/api/processes/runs'),
  runProcess: (id, input) => request(`/api/processes/run/${id}`, { method: 'POST', body: JSON.stringify({ input }) }),
}
