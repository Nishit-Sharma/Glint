// Adapted from Nexvyn UI at adece02509e44175c8a342ac0b1994cbb66e09c9.
// Original AiInput, icons, controlled-state hook and menu context retained.
// Unused menu/preview exports omitted; local imports and accessible labels added.
// License: MIT + Commons Clause; see ./LICENSE. Original file: references/upstream/nexvyn/ai-input.tsx.
'use client'
import {createContext,forwardRef,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type KeyboardEvent as ReactKeyboardEvent,type ReactNode} from 'react';
import {AnimatePresence,motion,useReducedMotion} from 'motion/react';
import {cn} from './utils';
import {springs} from './motion-tokens';
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

interface AiInputMenuCoordinatorValue {
  openId: string | null
  setOpenId: (id: string | null) => void
}

const AiInputMenuCoordinatorContext = createContext<AiInputMenuCoordinatorValue | null>(null)

const ARROW_UP_PATH =
  'M222.14,103.09,131.28,20.35a12,12,0,0,0-16.56,0L23.86,103.09A12,12,0,0,0,32,124a11.86,11.86,0,0,0,8.14-3.23L116,51.44V228a12,12,0,0,0,24,0V51.44l75.86,69.33A12,12,0,1,0,232,102.77Z'

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      className={cn('size-4', className)}
    >
      <path d={ARROW_UP_PATH} />
    </svg>
  )
}

const STOP_PATH =
  'M180,20H76A56.06,56.06,0,0,0,20,76V180a56.06,56.06,0,0,0,56,56H180a56.06,56.06,0,0,0,56-56V76A56.06,56.06,0,0,0,180,20Z'

function StopIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      className={cn('size-3.5', className)}
    >
      <path d={STOP_PATH} />
    </svg>
  )
}

const MICROPHONE_PATH =
  'M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V232a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z'

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      className={cn('size-4', className)}
    >
      <path d={MICROPHONE_PATH} />
    </svg>
  )
}

const SEND_WAVE_GRADIENT =
  'linear-gradient(180deg, transparent, color-mix(in oklch, var(--color-accent), transparent 88%), color-mix(in oklch, var(--color-accent), transparent 82%), transparent)'

function SendWave({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[inherit]"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        className="absolute inset-x-0 top-0 h-[150%] blur-xl"
        style={{ background: SEND_WAVE_GRADIENT }}
        initial={{ y: '55%' }}
        animate={reduceMotion ? { y: '-17%' } : { y: '-105%' }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      />
    </motion.div>
  )
}

function useControlledState(
  controlledValue: string | undefined,
  defaultValue: string | undefined,
  onValueChange: ((value: string) => void) | undefined,
): [string, (next: string) => void] {
  const [internal, setInternal] = useState(defaultValue ?? '')
  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : internal

  const setValue = useCallback(
    (next: string) => {
      if (!isControlled) setInternal(next)
      onValueChange?.(next)
    },
    [isControlled, onValueChange],
  )

  return [value, setValue]
}

export interface AiInputMessage {
  id: number
  text: string
}

export interface AiInputProps {
  active?: boolean
  clearOnSubmit?: boolean
  id?: string
  ariaLabel?: string
  submitLabel?: string
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  onSubmit?: (value: string) => void
  streaming?: boolean
  onStop?: () => void
  placeholder?: string
  maxRows?: number
  disabled?: boolean
  stopWhileDisabled?: boolean
  submitDisabled?: boolean
  name?: string
  startSlot?: ReactNode
  endSlot?: ReactNode
  showMessages?: boolean
  onMicClick?: () => void
  className?: string
}

export const AiInput = forwardRef<HTMLTextAreaElement, AiInputProps>(
  (
    {
      active = true,
      clearOnSubmit = true,
      id,
      ariaLabel,
      submitLabel = 'Send message',
      value: controlledValue,
      defaultValue,
      onValueChange,
      onSubmit,
      streaming = false,
      onStop,
      placeholder = 'Type a message…',
      maxRows = 6,
      disabled = false,
      stopWhileDisabled = false,
      submitDisabled = false,
      name,
      startSlot,
      endSlot,
      showMessages = false,
      onMicClick,
      className,
    },
    ref,
  ) => {
    const reduceMotion = useReducedMotion()
    const internalRef = useRef<HTMLTextAreaElement>(null)
    const messagesRef = useRef<HTMLDivElement>(null)
    const [launched, setLaunched] = useState(false)
    const launchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [messages, setMessages] = useState<AiInputMessage[]>([])
    const nextMessageIdRef = useRef(0)

    const setRefs = useCallback(
      (el: HTMLTextAreaElement | null) => {
        ;(internalRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
      },
      [ref],
    )

    const [value, setValue] = useControlledState(controlledValue, defaultValue, onValueChange)

    useIsoLayoutEffect(() => {
      if (!active) return
      const el = internalRef.current
      if (!el) return
      const resize = () => {
        el.style.height = 'auto'
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight)
        if (Number.isNaN(lineHeight)) return
        const max = lineHeight * maxRows
        el.style.height = `${Math.min(el.scrollHeight, max)}px`
        el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
      }
      resize()
      let width = el.getBoundingClientRect().width
      const observer = new ResizeObserver(() => {
        const nextWidth = el.getBoundingClientRect().width
        if (nextWidth === width) return
        width = nextWidth
        resize()
      })
      observer.observe(el)
      return () => observer.disconnect()
    }, [value, maxRows, active])

    const trimmed = value.trim()
    const canSend = !disabled && !submitDisabled && !streaming && trimmed.length > 0

    const handleSubmit = useCallback(() => {
      if (!canSend) return

      if (showMessages) {
        nextMessageIdRef.current += 1
        setMessages((prev) => [...prev, { id: nextMessageIdRef.current, text: trimmed }])
        requestAnimationFrame(() => {
          messagesRef.current?.scrollTo({
            top: messagesRef.current.scrollHeight,
            behavior: reduceMotion ? 'auto' : 'smooth',
          })
        })
      }

      if (!reduceMotion) {
        if (launchTimerRef.current !== null) clearTimeout(launchTimerRef.current)
        setLaunched(true)
        launchTimerRef.current = setTimeout(() => {
          setLaunched(false)
        }, 400)
      }

      onSubmit?.(trimmed)
      if (clearOnSubmit) setValue('')
    }, [canSend, onSubmit, trimmed, reduceMotion, showMessages, setValue, clearOnSubmit])

    const handleStop = useCallback(() => {
      onStop?.()
    }, [onStop])

    const handleKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          if (!streaming) {
            handleSubmit()
          }
        }
      },
      [streaming, handleSubmit],
    )

    useEffect(() => {
      return () => {
        if (launchTimerRef.current !== null) {
          clearTimeout(launchTimerRef.current)
        }
      }
    }, [])

    const showStop = streaming
    const buttonDisabled = !streaming && !canSend

    const [openMenuId, setOpenMenuId] = useState<string | null>(null)
    const coordinatorValue = useMemo(
      () => ({ openId: openMenuId, setOpenId: setOpenMenuId }),
      [openMenuId],
    )

    return (
      <AiInputMenuCoordinatorContext.Provider value={coordinatorValue}>
        <div className={cn('w-full', className)}>
          {showMessages && messages.length > 0 && (
            <div
              ref={messagesRef}
              className="mb-3 flex max-h-72 flex-col gap-2 overflow-y-auto overscroll-contain px-1 py-1 scrollbar-gutter-stable"
            >
              <AnimatePresence initial={false}>
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    layout="position"
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 420, damping: 34 }
                    }
                    className="max-w-[85%] self-end rounded-md rounded-br-lg bg-(--color-surface-2) px-4 py-2.5 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground"
                  >
                    {message.text}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          <div
            className={cn(
              'relative rounded-md squircle-corners border border-(--color-border) bg-(--color-card)',
              'transition-colors duration-(--motion-dur-fast) motion-reduce:transition-none',
              'focus-within:border-(--color-accent)',
              disabled && 'opacity-50 pointer-events-none',
            )}
          >
            <AnimatePresence>
              {launched && <SendWave reduceMotion={!!reduceMotion} />}
            </AnimatePresence>

            <textarea
              id={id}
              ref={setRefs}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              name={name}
              rows={1}
              aria-label={ariaLabel ?? placeholder}
              className={cn(
                'block max-h-40 w-full min-h-6 resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm text-foreground outline-none',
                'placeholder:text-muted-foreground',
              )}
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />

            <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
              {startSlot}

              {endSlot}

              <div className="ms-auto flex shrink-0 items-center gap-1">
                {onMicClick && (
                  <button
                    type="button"
                    onClick={onMicClick}
                    aria-label="Use voice input"
                    className={cn(
                      'inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-(--color-muted) outline-none',
                      'hover:bg-(--color-surface-2) hover:text-(--color-fg)',
                      'focus-visible:ring-2 focus-visible:ring-(--color-accent)',
                      'transition-colors duration-(--motion-dur-fast) motion-reduce:transition-none',
                    )}
                  >
                    <MicIcon />
                  </button>
                )}

                <button
                  type="button"
                  onClick={showStop ? handleStop : handleSubmit}
                  onPointerDown={(e) => e.preventDefault()}
                  disabled={buttonDisabled}
                  aria-label={showStop ? 'Stop' : submitLabel}
                  style={disabled && showStop && stopWhileDisabled ? { pointerEvents: 'auto' } : undefined}
                  className={cn(
                    'relative flex shrink-0 items-center justify-center size-8 rounded-full squircle cursor-pointer outline-none',
                    'bg-foreground text-background',
                    'transition-[opacity,transform] duration-(--motion-dur-fast) motion-reduce:transition-none',
                    'active:scale-95 motion-reduce:active:scale-100',
                    'disabled:opacity-40 disabled:pointer-events-none',
                    'focus-visible:ring-2 focus-visible:ring-(--color-accent) focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                  )}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {showStop ? (
                      <motion.span
                        key="stop"
                        className="flex items-center justify-center"
                        initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={reduceMotion ? undefined : { opacity: 0, scale: 0.9 }}
                        transition={reduceMotion ? { duration: 0 } : { duration: 0.12 }}
                      >
                        <StopIcon />
                      </motion.span>
                    ) : (
                      <motion.span
                        key="send"
                        className="flex items-center justify-center"
                        initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
                        animate={
                          launched && !reduceMotion
                            ? { opacity: 0, y: -8, scale: 0.9 }
                            : { opacity: 1, y: 0, scale: 1 }
                        }
                        exit={reduceMotion ? undefined : { opacity: 0, scale: 0.9 }}
                        transition={
                          reduceMotion
                            ? { duration: 0 }
                            : launched
                              ? { duration: 0.25, ease: [0.22, 1, 0.36, 1] }
                              : springs.fast
                        }
                      >
                        <SendIcon />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              </div>
            </div>
          </div>
        </div>
      </AiInputMenuCoordinatorContext.Provider>
    )
  },
)

AiInput.displayName = 'AiInput'

