import { Eye, EyeOff, LogIn } from "lucide-react"
import { FormEvent, useState } from "react"
import { Navigate } from "react-router-dom"

import bplasLogo from "@/assets/bplas-logo.svg"
import { getRoleHomeRoute } from "@/features/auth/auth-routes"
import { useAuth } from "@/features/auth/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function LoginPage() {
  const { currentUser, initializing, loading, login } = useAuth()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")

  if (initializing) return null
  if (currentUser) return <Navigate to={getRoleHomeRoute(currentUser.role)} replace />

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!username.trim() || !password) return setError("Kullanıcı adı ve şifre zorunludur.")
    setError("")
    try {
      await login(username, password)
    } catch {
      setError("Kullanıcı adı veya şifre hatalı.")
    }
  }

  return <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
    <section className="w-full max-w-[420px] rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7" aria-labelledby="login-title">
      <div className="mb-6 flex flex-col items-center text-center">
        <img src={bplasLogo} alt="BPLAS" className="size-12 rounded-lg object-cover shadow-sm" />
        <h1 id="login-title" className="mt-3 text-lg font-semibold text-slate-900">Ziyaret Yönetim Sistemi</h1>
      </div>
      <form className="space-y-4" onSubmit={(event) => { void submit(event) }}>
        <div className="space-y-1.5"><Label htmlFor="login-username">Kullanıcı adı</Label><Input id="login-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={loading} /></div>
        <div className="space-y-1.5"><Label htmlFor="login-password">Şifre</Label><div className="relative"><Input id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" className="pr-10" value={password} onChange={(event) => setPassword(event.target.value)} disabled={loading} /><Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-9 w-9 text-slate-500" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"} disabled={loading}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button></div></div>
        {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>{loading ? "Giriş yapılıyor…" : <><LogIn />Giriş Yap</>}</Button>
      </form>
    </section>
  </main>
}
