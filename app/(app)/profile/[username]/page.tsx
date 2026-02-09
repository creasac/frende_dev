import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import ProfileView from './ProfileView'

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const supabase = await createClient()

  // Get current authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch profile by username
  const { data: profile, error } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, bio, avatar_url')
    .eq('username', username.toLowerCase())
    .single()

  if (error || !profile) {
    notFound()
  }

  const isOwnProfile = user.id === profile.id

  return (
    <ProfileView
      profile={profile}
      isOwnProfile={isOwnProfile}
    />
  )
}
