import { useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { LogoMark } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/form'
import { useAuth } from '@/providers/AuthProvider'

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[#0B1020] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-60" style={{ background: 'radial-gradient(800px 500px at 80% 10%, rgba(124,120,245,.45), transparent 60%), radial-gradient(600px 400px at 0% 100%, rgba(56,189,248,.25), transparent 60%)' }} />
        <svg className="absolute -right-24 -bottom-24 h-[520px] w-[520px] opacity-[0.12]" viewBox="0 0 200 200" aria-hidden>
          {[90, 70, 50, 30].map((r) => <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="white" strokeWidth="1.5" />)}
          <circle cx="100" cy="100" r="8" fill="white" />
        </svg>
        <div className="relative flex items-center gap-3">
          <LogoMark size={40} />
          <div><div className="text-lg font-extrabold tracking-[0.2em]">LAKSHYA</div><div className="font-deva text-sm text-white/60">लक्ष्य</div></div>
        </div>
        <div className="relative mt-auto max-w-md">
          <h1 className="text-4xl leading-tight font-extrabold tracking-tight">Your Goals.<br />Your Time.<br /><span className="bg-gradient-to-r from-indigo-300 to-sky-300 bg-clip-text text-transparent">Your Journey.</span></h1>
          <p className="mt-4 text-white/70">One calendar. One workspace. One place for every responsibility – work, study, projects, habits and goals.</p>
          <ul className="mt-8 space-y-2 text-sm text-white/80">
            {['Plan your day with time blocks', 'Reminders on push, Telegram & email', 'Works offline · installable app', 'Your data stays yours – export anytime'].map((t) => (
              <li key={t} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-indigo-300" />{t}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm animate-slide-up">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><LogoMark size={36} /><div className="font-extrabold tracking-[0.2em]">LAKSHYA</div></div>
          <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
          <p className="mt-1 mb-6 text-sm text-muted">{subtitle}</p>
          {children}
          {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
        </div>
      </div>
    </div>
  )
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className="pr-10" />
      <button type="button" onClick={() => setShow(!show)} className="absolute top-2.5 right-3 text-subtle" aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

const emailSchema = z.string().trim().email('Enter a valid email')
const passwordSchema = z.string().min(8, 'At least 8 characters').max(72).regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number')

export function LoginPage() {
  const { signIn, session } = useAuth()
  const navigate = useNavigate()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password') })),
  })
  if (session) return <Navigate to="/" replace />
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to continue to your workspace." footer={<>New to LAKSHYA? <Link to="/signup" className="font-semibold text-primary">Create an account</Link></>}>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {
        try { await signIn(v.email, v.password); navigate('/') } catch (e) { toast.error((e as Error).message) }
      })}>
        <Field label="Email" error={errors.email?.message} htmlFor="l-email"><Input id="l-email" type="email" autoComplete="email" {...register('email')} /></Field>
        <Field label="Password" error={errors.password?.message} htmlFor="l-pw"><PasswordInput id="l-pw" autoComplete="current-password" {...register('password')} /></Field>
        <div className="text-right text-sm"><Link to="/forgot-password" className="font-semibold text-primary">Forgot password?</Link></div>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>Sign in</Button>
      </form>
    </AuthShell>
  )
}

export function SignupPage() {
  const { signUp, session } = useAuth()
  const navigate = useNavigate()
  const [sent, setSent] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(z.object({ name: z.string().trim().min(1, 'Enter your name').max(120), email: emailSchema, password: passwordSchema })),
  })
  if (session) return <Navigate to="/" replace />
  if (sent) return (
    <AuthShell title="Check your inbox" subtitle="We sent a confirmation link to your email. Open it to activate your account." footer={<Link to="/login" className="font-semibold text-primary">Back to sign in</Link>}>
      <p className="text-sm text-muted">Didn't get it? Check spam. Supabase's built-in mailer on the free plan sends a limited number of auth emails per hour.</p>
    </AuthShell>
  )
  return (
    <AuthShell title="Create your account" subtitle="Free forever. No credit card." footer={<>Already have an account? <Link to="/login" className="font-semibold text-primary">Sign in</Link></>}>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {
        try {
          const r = await signUp(v.email, v.password, v.name)
          if (r.needsConfirmation) setSent(true)
          else navigate('/')
        } catch (e) { toast.error((e as Error).message) }
      })}>
        <Field label="Full name" error={errors.name?.message} htmlFor="s-name"><Input id="s-name" autoComplete="name" {...register('name')} /></Field>
        <Field label="Email" error={errors.email?.message} htmlFor="s-email"><Input id="s-email" type="email" autoComplete="email" {...register('email')} /></Field>
        <Field label="Password" error={errors.password?.message} hint="8+ characters with a letter and a number" htmlFor="s-pw"><PasswordInput id="s-pw" autoComplete="new-password" {...register('password')} /></Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>Create account</Button>
      </form>
    </AuthShell>
  )
}

export function ForgotPasswordPage() {
  const { sendReset } = useAuth()
  const [sent, setSent] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(z.object({ email: emailSchema })) })
  return (
    <AuthShell title="Reset password" subtitle={sent ? 'If an account exists for that email, a reset link is on its way.' : "Enter your email and we'll send you a reset link."}
      footer={<Link to="/login" className="font-semibold text-primary">Back to sign in</Link>}>
      {!sent && (
        <form className="space-y-4" onSubmit={handleSubmit(async (v) => {
          try { await sendReset(v.email) } catch { /* don't reveal whether the account exists */ }
          setSent(true)
        })}>
          <Field label="Email" error={errors.email?.message} htmlFor="f-email"><Input id="f-email" type="email" autoComplete="email" {...register('email')} /></Field>
          <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const { updatePassword, session, loading } = useAuth()
  const navigate = useNavigate()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })),
  })
  if (!loading && !session) return (
    <AuthShell title="Link expired" subtitle="This reset link is invalid or has expired." footer={<Link to="/forgot-password" className="font-semibold text-primary">Request a new link</Link>}><span /></AuthShell>
  )
  return (
    <AuthShell title="Choose a new password" subtitle="You'll stay signed in after updating.">
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {
        try { await updatePassword(v.password); toast.success('Password updated'); navigate('/') } catch (e) { toast.error((e as Error).message) }
      })}>
        <Field label="New password" error={errors.password?.message} htmlFor="r-pw"><PasswordInput id="r-pw" autoComplete="new-password" {...register('password')} /></Field>
        <Field label="Confirm password" error={errors.confirm?.message} htmlFor="r-pw2"><PasswordInput id="r-pw2" autoComplete="new-password" {...register('confirm')} /></Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>Update password</Button>
      </form>
    </AuthShell>
  )
}
