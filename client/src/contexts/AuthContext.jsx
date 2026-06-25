import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('ownit_token')
    if (!token) { setLoading(false); return }
    api.me()
      .then(u => setUser(u))
      .catch(() => localStorage.removeItem('ownit_token'))
      .finally(() => setLoading(false))
  }, [])

  async function login(email, password) {
    const { token, user } = await api.login(email, password)
    localStorage.setItem('ownit_token', token)
    setUser(user)
  }

  function logout() {
    localStorage.removeItem('ownit_token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
