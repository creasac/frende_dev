import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/layout/AppShell'

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const profile = user
    ? (
        await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()
      ).data
    : null

  return <AppShell profile={profile}>{children}</AppShell>
}
