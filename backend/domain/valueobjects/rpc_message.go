package valueobjects

type RPCMessage []byte

var (
	RPC_ACK  = NewRPCMessage("ack")
	RPC_NACK = NewRPCMessage("nack")
)

func NewRPCMessage(message string) RPCMessage {
	return []byte(message)
}

func (m RPCMessage) Export() []byte {
	return ([]byte)(m)
}

func (m RPCMessage) ExportWith(message string) []byte {
	res := ([]byte)(m)
	res = append(res, " "...)
	res = append(res, message...)
	return res
}
