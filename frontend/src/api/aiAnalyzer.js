/**
 * AI Config Change Analyzer
 * Supports multiple AI providers: OpenAI, Anthropic Claude, Ollama (local)
 * Uses environment variables for configuration:
 *   VITE_AI_PROVIDER: 'openai' | 'anthropic' | 'ollama' | 'custom'
 *   VITE_AI_API_KEY: API key for the provider
 *   VITE_AI_MODEL: Model name (e.g., 'gpt-4', 'claude-3-opus', 'mistral')
 *   VITE_AI_API_ENDPOINT: For custom/Ollama (e.g., 'http://localhost:11434/api/generate')
 */

class AIAnalyzer {
  constructor() {
    this.provider = import.meta.env.VITE_AI_PROVIDER || null
    this.apiKey = import.meta.env.VITE_AI_API_KEY || null
    this.model = import.meta.env.VITE_AI_MODEL || null
    this.endpoint = import.meta.env.VITE_AI_API_ENDPOINT || null
    this.isConfigured = this.validateConfig()
    
    // Debug logging
    if (typeof window !== 'undefined') {
      console.log('[AIAnalyzer] Config:', {
        provider: this.provider,
        model: this.model,
        hasApiKey: !!this.apiKey,
        hasEndpoint: !!this.endpoint,
        isConfigured: this.isConfigured
      })
    }
  }

  validateConfig() {
    if (!this.provider) {
      console.warn('[AIAnalyzer] No VITE_AI_PROVIDER set')
      return false
    }
    
    if (this.provider === 'openai') {
      const valid = !!(this.apiKey && this.model)
      if (!valid) console.warn('[AIAnalyzer] OpenAI requires VITE_AI_API_KEY and VITE_AI_MODEL')
      return valid
    } else if (this.provider === 'anthropic') {
      const valid = !!(this.apiKey && this.model)
      if (!valid) console.warn('[AIAnalyzer] Anthropic requires VITE_AI_API_KEY and VITE_AI_MODEL')
      return valid
    } else if (this.provider === 'ollama') {
      const valid = !!(this.endpoint && this.model)
      if (!valid) console.warn('[AIAnalyzer] Ollama requires VITE_AI_API_ENDPOINT and VITE_AI_MODEL')
      return valid
    } else if (this.provider === 'custom') {
      const valid = !!(this.endpoint && this.apiKey && this.model)
      if (!valid) console.warn('[AIAnalyzer] Custom requires VITE_AI_API_ENDPOINT, VITE_AI_API_KEY, and VITE_AI_MODEL')
      return valid
    }
    console.warn(`[AIAnalyzer] Unknown provider: ${this.provider}`)
    return false
  }

  /**
   * Analyze config diff and return human-readable explanation
   * @param {string[]} diffLines - Array of diff lines (e.g., ['+added', '-removed', ' context'])
   * @param {object} context - Additional context (revisionA, revisionB, firewallIP, etc.)
   * @returns {Promise<{ summary: string, riskLevel: string, details: string }>}
   */
  async analyzeDiff(diffLines, context = {}) {
    if (!this.isConfigured) {
      throw new Error('AI analyzer not configured. Set VITE_AI_PROVIDER and related env vars.')
    }

    // Truncate diff if too large (limit to ~8000 tokens worth)
    const truncatedDiff = this.truncateDiff(diffLines)
    const prompt = this.buildPrompt(truncatedDiff, context)

    try {
      const response = await this.sendRequest(prompt)
      return this.parseResponse(response)
    } catch (err) {
      console.error('AI analysis error:', err)
      throw new Error(`Analysis failed: ${err.message}`)
    }
  }

  buildPrompt(diffLines, context) {
    const diffText = diffLines.join('\n')
    const firewallInfo = context.firewallIP ? `\nFirewall IP: ${context.firewallIP}` : ''
    const timelineInfo = context.revisionADate && context.revisionBDate 
      ? `\nChange period: ${new Date(context.revisionADate).toLocaleString()} → ${new Date(context.revisionBDate).toLocaleString()}`
      : ''

    return `You are an expert network/firewall engineer. Analyze the configuration diff below and provide:
1. A brief summary (2-3 sentences) of what changed
2. Risk assessment: Low (safe), Medium (moderate change), or High (critical)
3. Technical details of what was modified

Configuration Diff:
\`\`\`diff
${diffText}
\`\`\`
${firewallInfo}${timelineInfo}

Respond in this exact JSON format:
{
  "summary": "Brief explanation of changes",
  "riskLevel": "Low|Medium|High",
  "details": "Technical details of what changed"
}`
  }

  truncateDiff(diffLines) {
    // Keep only first 200 lines or ~5000 chars to avoid token limits
    const maxLines = 200
    const maxChars = 5000

    let truncated = diffLines.slice(0, maxLines)
    let text = truncated.join('\n')

    if (text.length > maxChars) {
      text = text.substring(0, maxChars) + '\n... (truncated)'
      truncated = text.split('\n')
    }

    return truncated
  }

  async sendRequest(prompt) {
    if (this.provider === 'openai') {
      return this.sendOpenAI(prompt)
    } else if (this.provider === 'anthropic') {
      return this.sendAnthropic(prompt)
    } else if (this.provider === 'ollama') {
      return this.sendOllama(prompt)
    } else if (this.provider === 'custom') {
      return this.sendCustom(prompt)
    }
    throw new Error(`Unknown provider: ${this.provider}`)
  }

  async sendOpenAI(prompt) {
    // Support custom OpenAI-compatible endpoints (vLLM, LiteLLM, etc.)
    const baseURL = this.endpoint || 'https://api.openai.com/v1'
    const url = `${baseURL}/chat/completions`
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3, // Lower temp for consistent, factual responses
        max_tokens: 500
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`)
    }

    const data = await response.json()
    return data.choices[0].message.content
  }

  async sendAnthropic(prompt) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`Anthropic API error: ${error.error?.message || response.statusText}`)
    }

    const data = await response.json()
    return data.content[0].text
  }

  async sendOllama(prompt) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: prompt,
        stream: false,
        temperature: 0.3
      })
    })

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`)
    }

    const data = await response.json()
    return data.response
  }

  async sendCustom(prompt) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ prompt, model: this.model })
    })

    if (!response.ok) {
      throw new Error(`Custom API error: ${response.statusText}`)
    }

    const data = await response.json()
    return data.response || data.text || data.content
  }

  parseResponse(responseText) {
    try {
      // Try to extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        // If no JSON found, create basic response
        return {
          summary: responseText.substring(0, 200),
          riskLevel: 'Medium',
          details: responseText
        }
      }

      const parsed = JSON.parse(jsonMatch[0])
      return {
        summary: parsed.summary || 'Unable to parse response',
        riskLevel: (parsed.riskLevel || 'Medium').split('|')[0].trim(),
        details: parsed.details || ''
      }
    } catch (err) {
      return {
        summary: responseText.substring(0, 200),
        riskLevel: 'Medium',
        details: responseText
      }
    }
  }

  getRiskColor(level) {
    switch ((level || 'Medium').toLowerCase()) {
      case 'low':
        return 'text-green-600 dark:text-green-400'
      case 'high':
        return 'text-red-600 dark:text-red-400'
      case 'medium':
      default:
        return 'text-yellow-600 dark:text-yellow-400'
    }
  }

  getRiskBgColor(level) {
    switch ((level || 'Medium').toLowerCase()) {
      case 'low':
        return 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800'
      case 'high':
        return 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
      case 'medium':
      default:
        return 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800'
    }
  }

  getStatusMessage() {
    if (this.isConfigured) {
      return `✅ Ready (${this.provider.toUpperCase()}: ${this.model})`
    }
    
    if (!this.provider) {
      return '❌ Set VITE_AI_PROVIDER in .env'
    }
    
    if (this.provider === 'openai') {
      if (!this.apiKey) return '❌ Missing: VITE_AI_API_KEY'
      if (!this.model) return '❌ Missing: VITE_AI_MODEL'
    } else if (this.provider === 'anthropic') {
      if (!this.apiKey) return '❌ Missing: VITE_AI_API_KEY'
      if (!this.model) return '❌ Missing: VITE_AI_MODEL'
    } else if (this.provider === 'ollama') {
      if (!this.endpoint) return '❌ Missing: VITE_AI_API_ENDPOINT'
      if (!this.model) return '❌ Missing: VITE_AI_MODEL'
    } else if (this.provider === 'custom') {
      if (!this.endpoint) return '❌ Missing: VITE_AI_API_ENDPOINT'
      if (!this.apiKey) return '❌ Missing: VITE_AI_API_KEY'
      if (!this.model) return '❌ Missing: VITE_AI_MODEL'
    }
    
    return `❌ Unknown provider: ${this.provider}`
  }
}

// Export singleton instance
export const aiAnalyzer = new AIAnalyzer()

export default aiAnalyzer
