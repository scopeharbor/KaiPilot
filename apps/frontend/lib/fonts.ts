import localFont from 'next/font/local'

export const sansFont = localFont({
  src: [
    {
      path: '../public/fonts/misans/misans-regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../public/fonts/misans/misans-medium.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../public/fonts/misans/misans-semibold.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../public/fonts/misans/misans-bold.woff2',
      weight: '700',
      style: 'normal',
    },
    {
      path: '../public/fonts/manrope/manrope-latin-400.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../public/fonts/manrope/manrope-latin-500.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../public/fonts/manrope/manrope-latin-600.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../public/fonts/manrope/manrope-latin-700.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  display: 'swap',
  variable: '--font-sans-local',
  fallback: ['PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'sans-serif'],
})
