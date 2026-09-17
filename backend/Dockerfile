FROM golang:1.23-alpine AS builder
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /app/server .

FROM alpine:3.20
WORKDIR /app
COPY --from=builder /app/server /app/server
EXPOSE 8080
CMD ["/app/server"]
