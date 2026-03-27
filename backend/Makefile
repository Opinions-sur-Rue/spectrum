docs: 
	swag fmt && swag init

lint: 
	golangci-lint run

test:
	gotestsum -f short-verbose -- -short -coverprofile=cover.out ./...

tools:
	go install github.com/daixiang0/gci@latest
	go install github.com/swaggo/swag/cmd/swag@latest
	go install gotest.tools/gotestsum@latest

.PHONY: docs
