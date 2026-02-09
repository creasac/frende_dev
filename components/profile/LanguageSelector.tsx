'use client'

interface Language {
  code: string
  name: string
}

export default function LanguageSelector({
  languages,
  selectedLanguage,
  onLanguageChange,
}: {
  languages: Language[]
  selectedLanguage: string
  onLanguageChange: (languageCode: string) => void
}) {
  return (
    <select
      value={selectedLanguage}
      onChange={(e) => onLanguageChange(e.target.value)}
      className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-azure focus:outline-none focus:ring-2 focus:ring-azure"
    >
      {languages.map((language) => (
        <option key={language.code} value={language.code}>
          {language.name}
        </option>
      ))}
    </select>
  )
}






