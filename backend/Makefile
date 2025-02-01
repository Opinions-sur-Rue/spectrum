docs: 
	swag fmt && swag init

lint: 
	golangci-lint run

test:
	gotestsum -f short-verbose -- -short -coverprofile=cover.out ./...

tools:
	go install github.com/daixiang0/gci@latest

.PHONY: docs