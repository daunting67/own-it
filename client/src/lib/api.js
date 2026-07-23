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
  login: (name, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ name, password }) }),
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
  runProcess: (id, input, coordinator) => request(`/api/processes/run/${id}`, { method: 'POST', body: JSON.stringify({ input, coordinator }) }),
  getProcessPeople: () => request('/api/processes/people'),
  getRunDocument: (id) => request(`/api/processes/runs/${id}/document`),

  // Otter
  getOtterSpeeches: () => request('/api/otter/speeches'),
  getOtterTranscript: (id) => request(`/api/otter/transcript/${id}`),

  // Schedule of Quantities
  getSoqRuns: () => request('/api/soq/runs'),
  getSoqRunDocument: (id) => request(`/api/soq/runs/${id}/document`),
  getSoqUploadUrl: (filename) => request('/api/soq/upload-url', { method: 'POST', body: JSON.stringify({ filename }) }),
  runSoq: (paths, projectName, notes) =>
    request('/api/soq/run', { method: 'POST', body: JSON.stringify({ paths, projectName, notes }) }),

  // Cost Control — fuel receipt reconciliation
  getCostControlRuns: () => request('/api/cost-control/runs'),
  getCostControlRunDocument: (id) => request(`/api/cost-control/runs/${id}/document`),
  getCostControlUploadUrl: (filename) => request('/api/cost-control/upload-url', { method: 'POST', body: JSON.stringify({ filename }) }),
  runCostControl: (invoicePaths, receiptPaths) =>
    request('/api/cost-control/run', { method: 'POST', body: JSON.stringify({ invoicePaths, receiptPaths }) }),
}

// Upload a File straight to Supabase Storage via a signed upload URL (bypasses the
// backend's serverless request-size limit). Sends the file as a raw body — the signed
// URL's token is self-authenticating, so no Supabase API key is needed client-side.
export async function uploadToSignedUrl(signedUrl, file) {
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'x-upsert': 'true', 'cache-control': '3600', 'content-type': file.type || 'application/pdf' },
    body: file
  })
  if (!res.ok) {
    let msg = `Upload failed (${res.status})`
    try { msg = (await res.json()).message || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
}
