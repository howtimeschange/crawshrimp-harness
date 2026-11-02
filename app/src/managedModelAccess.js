'use strict'
// The account model catalogue is the sole authority, including future model families.
// Keep the call signature stable for existing broker callers; do not infer access from plan or balance.
function officialModelAvailable(id, _plan, catalog = []) {
  return catalog.find(model => model.id === id)?.available === true
}
const modelAccessMessage = '该模型当前不可用，请刷新官方模型目录，或在账号中心查看使用权限。'
module.exports = { officialModelAvailable, modelAccessMessage }
