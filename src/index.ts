import { serve } from '@hono/node-server'
import app from './server.js'

const port = 3005

serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    console.log(`🚀 Server running on http://localhost:${info.port}`)
  }
)