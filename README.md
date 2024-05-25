# 2024 4학년 캡스톤디자인 - 개발 파트

## 개선사항

### 1. 예외 처리 코드 추가

- 모든 API에 request param 검증 로직 추가

```
// 예시
const { amount, sender, recipient, message } = req.body;
if (!amount || amount < 1 || !sender || !recipient || !message) {
return res.status(400).json({ note: "입력값이 잘못되었습니다." });
}
```

- 모든 API에 에러 대응 로직 추가

```
// 예시
requestPromises.push(
    rp(requestOptions).catch((error) =>
    console.log(
        `transaction broadcasting에 실패했습니다. ${requestOptions}`,
        error
    )
    )
);
```

- 조회한 트랜잭션이나 블록이 없을 경우 에러 반환 로직 추가

```
// 예시
app.get("/block/:blockHash", function (req, res) {
  const blockHash = req.params.blockHash;
  const correctBlock = bitcoin.getBlock(blockHash);

  if (!correctBlock) {
    res
      .status(400)
      .json({ note: `${blockHash}에 해당하는 block을 찾을 수 없습니다.` });
  }

  res.json({
    block: correctBlock,
  });
});
```

### 2. 코인 송금 전 잔액 체크 로직 추가

- 트랜잭션 생성 시 모든 chain을 순회하며 잔액을 확인하고, 송금할 금액보다 잔액이 적은 경우 에러를 반환

```
createNewTransaction(amount, sender, recipient, message) {
const senderBalance = this.getAddressData(sender).addressBalance;
if (amount > senderBalance) {
    throw new Error("잔액 부족");
}

...

return newTransaction;
}
```

### 블록체인에 더 다양한 데이터를 저장할 수 있는 로직 추가

- 트랜잭션에 송금 메시지를 함께 반환

```
createNewTransaction(amount, sender, recipient, message) {
...

const newTransaction = {
    amount: amount,
    sender: sender,
    recipient: recipient,
    message: message,
    transactionId: uuid().split("-").join(""),
};

return newTransaction;
}
```
