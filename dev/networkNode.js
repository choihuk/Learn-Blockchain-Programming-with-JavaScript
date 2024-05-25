const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const Blockchain = require("./blockchain");
const uuid = require("uuid/v1");
const port = process.argv[2];
const rp = require("request-promise");

const nodeAddress = uuid().split("-").join("");

const bitcoin = new Blockchain();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// get entire blockchain
app.get("/blockchain", function (req, res) {
  res.send(bitcoin);
});

// create a new transaction
app.post("/transaction", function (req, res) {
  const newTransaction = req.body;
  const blockIndex =
    bitcoin.addTransactionToPendingTransactions(newTransaction);
  res.json({ note: `Transaction will be added in block ${blockIndex}.` });
});

// broadcast transaction
app.post("/transaction/broadcast", function (req, res) {
  const { amount, sender, recipient, message } = req.body;
  if (!amount || amount < 1 || !sender || !recipient || !message) {
    return res.status(400).json({ note: "입력값이 잘못되었습니다." });
  }

  const newTransaction = bitcoin.createNewTransaction(
    amount,
    sender,
    recipient,
    message
  );
  bitcoin.addTransactionToPendingTransactions(newTransaction);

  const requestPromises = [];
  bitcoin.networkNodes.forEach((networkNodeUrl) => {
    const requestOptions = {
      uri: networkNodeUrl + "/transaction",
      method: "POST",
      body: newTransaction,
      json: true,
    };

    requestPromises.push(
      rp(requestOptions).catch((error) =>
        console.log(
          `transaction broadcasting에 실패했습니다. ${requestOptions}`,
          error
        )
      )
    );
  });

  Promise.all(requestPromises)
    .then((data) => {
      res.json({ note: "Transaction created and broadcast successfully." });
    })
    .catch((error) => {
      res
        .status(500)
        .json({ note: "transaction broadcasting에 실패했습니다.", error });
    });
});

// mine a block
app.get("/mine", function (req, res) {
  const lastBlock = bitcoin.getLastBlock();
  const previousBlockHash = lastBlock["hash"];
  const currentBlockData = {
    transactions: bitcoin.pendingTransactions,
    index: lastBlock["index"] + 1,
  };
  const nonce = bitcoin.proofOfWork(previousBlockHash, currentBlockData);
  const blockHash = bitcoin.hashBlock(
    previousBlockHash,
    currentBlockData,
    nonce
  );
  const newBlock = bitcoin.createNewBlock(nonce, previousBlockHash, blockHash);

  const requestPromises = [];
  bitcoin.networkNodes.forEach((networkNodeUrl) => {
    const requestOptions = {
      uri: networkNodeUrl + "/receive-new-block",
      method: "POST",
      body: { newBlock: newBlock },
      json: true,
    };

    requestPromises.push(
      rp(requestOptions).catch((error) =>
        console.log(
          `새로운 block에 broadcasting을 실패했습니다. ${requestOptions}`,
          error
        )
      )
    );
  });

  Promise.all(requestPromises)
    .then((data) => {
      const requestOptions = {
        uri: bitcoin.currentNodeUrl + "/transaction/broadcast",
        method: "POST",
        body: {
          amount: 12.5,
          sender: "00",
          recipient: nodeAddress,
          message: "mining reward",
        },
        json: true,
      };

      return rp(requestOptions);
    })
    .then((data) => {
      res.json({
        note: "New block mined & broadcast successfully",
        block: newBlock,
      });
    })
    .catch((error) => {
      res.status(500).json({ note: "block mining에 실패했습니다.", error });
    });
});

// receive new block
app.post("/receive-new-block", function (req, res) {
  const newBlock = req.body.newBlock;
  const lastBlock = bitcoin.getLastBlock();
  const correctHash = lastBlock.hash === newBlock.previousBlockHash;
  const correctIndex = lastBlock["index"] + 1 === newBlock["index"];

  if (correctHash && correctIndex) {
    bitcoin.chain.push(newBlock);
    bitcoin.pendingTransactions = [];
    res.json({
      note: "New block received and accepted.",
      newBlock: newBlock,
    });
  } else {
    res.json({
      note: "New block rejected.",
      newBlock: newBlock,
    });
  }
});

// register a node and broadcast it the network
app.post("/register-and-broadcast-node", function (req, res) {
  const newNodeUrl = req.body.newNodeUrl;

  if (!newNodeUrl) {
    return res.status(400).json({ note: "newNodeUrl이 필요합니다." });
  }

  if (bitcoin.networkNodes.indexOf(newNodeUrl) == -1)
    bitcoin.networkNodes.push(newNodeUrl);

  const regNodesPromises = [];
  bitcoin.networkNodes.forEach((networkNodeUrl) => {
    const requestOptions = {
      uri: networkNodeUrl + "/register-node",
      method: "POST",
      body: { newNodeUrl: newNodeUrl },
      json: true,
    };

    regNodesPromises.push(
      rp(requestOptions).catch((error) =>
        console.log(`비정상적인 networkNodeUrl입니다. ${networkNodeUrl}`, error)
      )
    );
  });

  Promise.all(regNodesPromises)
    .then((data) => {
      const bulkRegisterOptions = {
        uri: newNodeUrl + "/register-nodes-bulk",
        method: "POST",
        body: {
          allNetworkNodes: [...bitcoin.networkNodes, bitcoin.currentNodeUrl],
        },
        json: true,
      };

      return rp(bulkRegisterOptions);
    })
    .then((data) => {
      res.json({ note: "New node registered with network successfully." });
    })
    .catch((error) => {
      res.status(500).json({
        note: "새로운 노드를 등록하고 broadcast하는데 실패했습니다.",
        error,
      });
    });
});

// register a node with the network
app.post("/register-node", function (req, res) {
  const newNodeUrl = req.body.newNodeUrl;

  if (!newNodeUrl) {
    return res.status(400).json({ note: "newNodeUrl이 필요합니다." });
  }

  const nodeNotAlreadyPresent = bitcoin.networkNodes.indexOf(newNodeUrl) == -1;
  const notCurrentNode = bitcoin.currentNodeUrl !== newNodeUrl;
  if (nodeNotAlreadyPresent && notCurrentNode) {
    bitcoin.networkNodes.push(newNodeUrl);
    res.json({ note: "New node registered successfully." });
  } else {
    res
      .status(400)
      .json({ note: "등록할 노드가 이미 존재하거나 현재 노드입니다." });
  }
});

// register multiple nodes at once
app.post("/register-nodes-bulk", function (req, res) {
  const allNetworkNodes = req.body.allNetworkNodes;

  if (!allNetworkNodes) {
    return res.status(400).json({ note: "allNetworkNodes가 필요합니다." });
  }

  allNetworkNodes.forEach((networkNodeUrl) => {
    const nodeNotAlreadyPresent =
      bitcoin.networkNodes.indexOf(networkNodeUrl) == -1;
    const notCurrentNode = bitcoin.currentNodeUrl !== networkNodeUrl;
    if (nodeNotAlreadyPresent && notCurrentNode)
      bitcoin.networkNodes.push(networkNodeUrl);
  });

  res.json({ note: "Bulk registration successful." });
});

// consensus
app.get("/consensus", function (req, res) {
  const requestPromises = [];
  bitcoin.networkNodes.forEach((networkNodeUrl) => {
    const requestOptions = {
      uri: networkNodeUrl + "/blockchain",
      method: "GET",
      json: true,
    };

    requestPromises.push(
      rp(requestOptions).catch((error) => {
        console.error(
          `${networkNodeUrl}에 해당하는 블록체인을 가져오는데 실패했습니다.`,
          err
        );
        return null;
      })
    );
  });

  Promise.all(requestPromises)
    .then((blockchains) => {
      const consensusBlockchains = blockchains.filter(
        (blockchain) => blockchain !== null
      );

      if (consensusBlockchains.length === 0) {
        return res.status(500).json({
          note: "consensus할 블록체인이 없습니다.",
        });
      }

      const currentChainLength = bitcoin.chain.length;
      let maxChainLength = currentChainLength;
      let newLongestChain = null;
      let newPendingTransactions = null;

      consensusBlockchains.forEach((blockchain) => {
        if (blockchain.chain.length > maxChainLength) {
          maxChainLength = blockchain.chain.length;
          newLongestChain = blockchain.chain;
          newPendingTransactions = blockchain.pendingTransactions;
        }
      });

      if (
        !newLongestChain ||
        (newLongestChain && !bitcoin.chainIsValid(newLongestChain))
      ) {
        res.json({
          note: "Current chain has not been replaced.",
          chain: bitcoin.chain,
        });
      } else {
        bitcoin.chain = newLongestChain;
        bitcoin.pendingTransactions = newPendingTransactions;
        res.json({
          note: "This chain has been replaced.",
          chain: bitcoin.chain,
        });
      }
    })
    .catch((error) => {
      res.status(500).json({ note: "consensus 작업에 실패했습니다.", error });
    });
});

// get block by blockHash
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

// get transaction by transactionId
app.get("/transaction/:transactionId", function (req, res) {
  const transactionId = req.params.transactionId;
  const transactionData = bitcoin.getTransaction(transactionId);

  if (!transactionData.transaction || !transactionData.block) {
    res.status(400).json({
      note: `${transactionId}에 해당하는 트랜잭션을 찾을 수 없습니다.`,
    });
  }

  res.json({
    transaction: transactionData.transaction,
    block: transactionData.block,
  });
});

// get address by address
app.get("/address/:address", function (req, res) {
  const address = req.params.address;
  const addressData = bitcoin.getAddressData(address);
  res.json({
    addressData: addressData,
  });
});

// block explorer
app.get("/block-explorer", function (req, res) {
  res.sendFile("./block-explorer/index.html", { root: __dirname });
});

app.listen(port, function () {
  console.log(`Listening on port ${port}...`);
});
