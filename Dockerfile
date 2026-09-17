FROM golang:1.23-alpine AS builder
WORKDIR /src/backend

COPY backend/go.mod ./
RUN go mod download
COPY backend/ ./

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/auction-backend .

FROM alpine:3.20
WORKDIR /app
COPY --from=builder /out/auction-backend /app/auction-backend
ENV PORT=10000
EXPOSE 10000
CMD ["/app/auction-backend"]
