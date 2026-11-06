// Geist Spinner (https://vercel.com/geist/spinner): 12 fading bars.
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span role="status" aria-label="Loading" className="relative inline-block text-gray-700" style={{ width: size, height: size }}>
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          className="absolute left-[46%] top-[4%] h-[30%] w-[8%] rounded-full bg-current"
          style={{
            transformOrigin: '50% 155%',
            transform: `rotate(${i * 30}deg)`,
            animation: 'geist-spinner 1.2s linear infinite',
            animationDelay: `${-1.2 + i * 0.1}s`
          }}
        />
      ))}
    </span>
  )
}
