FROM node:16

ENV TZ=America/Sao_Paulo DEBIAN_FRONTEND=noninteractive

WORKDIR /app 

COPY . .

RUN apt update && apt install -y git tzdata && npm i

ENTRYPOINT ["node", "index.js"]