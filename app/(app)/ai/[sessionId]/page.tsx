import { redirect } from 'next/navigation'

export default async function AiChatSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  redirect(`/chat/ai/${sessionId}`)
}
