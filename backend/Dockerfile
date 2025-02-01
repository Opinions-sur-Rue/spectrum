FROM golang:alpine AS build
WORKDIR /app

RUN apk add -U --no-cache ca-certificates

COPY . .
RUN CGO_ENABLED=0 go build -o server .


FROM scratch AS runtime

COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /app/server /

EXPOSE 3000/tcp
CMD ["/server"]
