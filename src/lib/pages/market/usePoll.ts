import { useState, useEffect } from 'react'

export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export const calcDelay = (interval: number): number => {
  const now = Date.now()
  const date = new Date(now)
  const offset = date.getTimezoneOffset() / 60
  return interval - (now % interval) + (interval === DAY ? offset : 0)
}

export default (
  execute: () => Promise<void>,
  interval: number
): void => {
  const [timeoutId, setTimeoutId] = useState<number>()

  useEffect(() => {
    return (): void => window.clearTimeout(timeoutId)
  }, [timeoutId])

  useEffect(() => {
    const poll = (): void => {
      execute()
      const id = window.setTimeout(() => poll(), calcDelay(interval))
      setTimeoutId(id)
    }

    poll()
  }, [interval, execute])
}
