import { NextRequest, NextResponse } from 'next/server'
import { generateGeminiContent, isGeminiConfigured } from '@/lib/ai/gemini'
import { createClient } from '@/lib/supabase/server'
import { getLanguageName } from '@/lib/constants/languages'
import { pickContextMessages } from '@/lib/ai/context'

const MAX_CANDIDATE_MESSAGES = 50

export async function POST(request: NextRequest) {
  try {
    const { sessionId, messageId } = await request.json()

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    if (!isGeminiConfigured()) {
      return NextResponse.json({ error: 'Service not configured' }, { status: 500 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: session, error: sessionError } = await supabase
      .from('ai_chat_sessions')
      .select('id, user_id, name, system_prompt, response_language, response_level')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session || session.user_id !== user.id) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const { data: messages, error: messagesError } = await supabase
      .from('ai_chat_messages')
      .select('id, role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(MAX_CANDIDATE_MESSAGES)

    if (messagesError || !messages) {
      return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
    }

    const orderedMessages = messages.slice().reverse()
    const { currentMessage, contextMessages } = pickContextMessages(orderedMessages, messageId || null)

    if (!currentMessage || !currentMessage.content.trim()) {
      return NextResponse.json({ error: 'No message content to process' }, { status: 400 })
    }

    const instructionLines = [
      'You are an AI assistant in a chat app.',
      'Respond only to the latest user message.',
      'Use any prior messages only if they are relevant to the latest question.',
      'Be helpful, clear, and concise unless the user asks for more detail.',
    ]

    if (session.system_prompt) {
      instructionLines.push(`System prompt: ${session.system_prompt}`)
    }

    if (session.response_language) {
      const languageName = getLanguageName(session.response_language)
      instructionLines.push(`Respond in ${languageName}.`)
    }

    if (session.response_level) {
      const levelDescriptions = {
        beginner: 'A1-A2 level: very simple vocabulary, short sentences, basic grammar.',
        intermediate: 'B1-B2 level: moderately complex vocabulary and sentence structure.',
        advanced: 'C1-C2 level: sophisticated vocabulary and nuanced, fluent expression.',
      }
      const levelKey = session.response_level as keyof typeof levelDescriptions
      instructionLines.push(`Use ${levelDescriptions[levelKey]}`)
    }

    const historyLines = contextMessages.map((msg) => `User: ${msg.content}`)
    const promptSections = [
      instructionLines.join(' '),
      historyLines.length > 0 ? `Relevant previous user messages:\n${historyLines.join('\n')}` : '',
      `User: ${currentMessage.content}`,
      'Assistant:',
    ].filter(Boolean)

    const prompt = promptSections.join('\n\n')

    const result = await generateGeminiContent({ request: prompt })
    const response = await result.response
    const responseText = response.text().trim()

    if (!responseText) {
      return NextResponse.json({ error: 'Empty response from AI' }, { status: 500 })
    }

    const { error: insertError, data: inserted } = await supabase
      .from('ai_chat_messages')
      .insert({
        session_id: sessionId,
        role: 'assistant',
        content: responseText,
      })
      .select('id')
      .single()

    if (insertError) {
      return NextResponse.json({ error: 'Failed to save AI response' }, { status: 500 })
    }

    await supabase
      .from('ai_chat_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId)

    return NextResponse.json({ message_id: inserted.id, content: responseText })
  } catch (error) {
    console.error('[ai-chat API] Error:', error)
    return NextResponse.json({ error: 'Failed to generate response' }, { status: 500 })
  }
}
