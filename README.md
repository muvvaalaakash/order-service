# Order Service
Order lifecycle management.

## Endpoints
- `POST /orders` — Create order
- `GET /orders/:userId` — Get user orders
- `GET /orders/detail/:orderId` — Order details
- `PUT /orders/:orderId/status` — Update status
- `PUT /orders/:orderId/cancel` — Cancel order
- `GET /orders` — All orders (admin)
- `GET /health` — Health check
