import { NextRequest, NextResponse } from 'next/server'
import { generateGeminiContent, isGeminiConfigured } from '@/lib/ai/gemini'
import {
  MAX_CHAT_MESSAGES,
  MAX_CHAT_MESSAGE_CHARS,
  MAX_CHAT_TOTAL_CHARS,
  MAX_TEXT_REQUEST_BYTES,
  enforceApiGuards,
  enforceArraySizeLimit,
  enforceCharacterCountLimit,
  enforceTextLimit,
} from '@/lib/api/abuse-guard'

type IncomingMessage = {
  role: 'user' | 'assistant'
  content: string
}

const MAX_CONTEXT_MESSAGES = 12
const MAX_CONTEXT_CHARS = 4000

function normalizeMessages(rawMessages: unknown): IncomingMessage[] {
  if (!Array.isArray(rawMessages)) {
    return []
  }

  return rawMessages.reduce<IncomingMessage[]>((acc, message) => {
    if (!message || typeof message !== 'object') {
      return acc
    }

    const candidate = message as { role?: unknown; content?: unknown }
    const role = candidate.role === 'user' || candidate.role === 'assistant' ? candidate.role : null
    const content = typeof candidate.content === 'string' ? candidate.content.trim() : ''

    if (role && content) {
      acc.push({ role, content })
    }

    return acc
  }, [])
}

function trimMessages(messages: IncomingMessage[]): IncomingMessage[] {
  const trimmed: IncomingMessage[] = []
  let totalChars = 0

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (trimmed.length >= MAX_CONTEXT_MESSAGES) {
      break
    }

    const message = messages[i]
    let content = message.content.trim()
    if (!content) continue

    if (trimmed.length === 0 && content.length > MAX_CONTEXT_CHARS) {
      content = content.slice(0, MAX_CONTEXT_CHARS)
    }

    if (totalChars + content.length > MAX_CONTEXT_CHARS) {
      continue
    }

    trimmed.push({ role: message.role, content })
    totalChars += content.length
  }

  return trimmed.reverse()
}

export async function POST(request: NextRequest) {
  try {
    const guardResponse = enforceApiGuards(request, {
      routeKey: 'ai-chat-temporary',
      preset: 'aiText',
      maxBodyBytes: MAX_TEXT_REQUEST_BYTES,
    })
    if (guardResponse) {
      return guardResponse
    }

    if (!isGeminiConfigured()) {
      return NextResponse.json({ error: 'Service not configured' }, { status: 500 })
    }

    const body = await request.json()
    const rawMessages = Array.isArray(body?.messages) ? body.messages : []
    const messageArrayLimit = enforceArraySizeLimit('messages', rawMessages.length, MAX_CHAT_MESSAGES)
    if (messageArrayLimit) {
      return messageArrayLimit
    }

    const messages = normalizeMessages(body?.messages)
    const totalMessageChars = messages.reduce((total, message) => total + message.content.length, 0)
    const totalLengthLimit = enforceCharacterCountLimit(
      'conversation content',
      totalMessageChars,
      MAX_CHAT_TOTAL_CHARS
    )
    if (totalLengthLimit) {
      return totalLengthLimit
    }

    for (const message of messages) {
      const messageLengthLimit = enforceTextLimit(
        'message content',
        message.content,
        MAX_CHAT_MESSAGE_CHARS
      )
      if (messageLengthLimit) {
        return messageLengthLimit
      }
    }

    if (messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 })
    }

    const lastUserIndex = [...messages].reverse().findIndex((msg) => msg.role === 'user')
    if (lastUserIndex === -1) {
      return NextResponse.json({ error: 'No user message provided' }, { status: 400 })
    }

    const cutoffIndex = messages.length - 1 - lastUserIndex
    const relevant = messages.slice(0, cutoffIndex + 1)
    const trimmed = trimMessages(relevant)

    if (trimmed.length === 0) {
      return NextResponse.json({ error: 'No valid message content' }, { status: 400 })
    }

    const instructionLines = [
      'You are an AI assistant in a chat app.',
      'Respond to the latest user message.',
      'Be helpful, clear, and concise unless the user asks for more detail.',
    ]

    const conversationLines = trimmed.map((msg) => {
      const prefix = msg.role === 'user' ? 'User' : 'Assistant'
      return `${prefix}: ${msg.content}`
    })

    const promptSections = [
      instructionLines.join(' '),
      conversationLines.length > 0 ? `Conversation:\n${conversationLines.join('\n')}` : '',
      'Assistant:',
    ].filter(Boolean)

    const prompt = promptSections.join('\n\n')

    const result = await generateGeminiContent({ request: prompt })
    const response = await result.response
    const responseText = response.text().trim()

    if (!responseText) {
      return NextResponse.json({ error: 'Empty response from AI' }, { status: 500 })
    }

    return NextResponse.json({ content: responseText })
  } catch (error) {
    console.error('[ai-chat temporary API] Error:', error)
    return NextResponse.json({ error: 'Failed to generate response' }, { status: 500 })
  }
}
