const GRID_SIZE = 80;      // 格子大小
const BOARD_PADDING = 40;  // 棋盘边距

let selectedPiece = null;  // 当前选中的棋子
let playerSide = 'red';    // 玩家执子方：'red' | 'black'
let busy = false;          // 等待引擎响应时锁定棋盘
let flipView = false;      // 执黑时棋盘翻转 180°，让自己的棋子在下方

// 初始布局（与 chess.html 中的棋子一一对应）
const INITIAL_PIECES = [
    // 红方
    ['red-che', 'a0', '车'], ['red-ma', 'b0', '马'], ['red-xiang', 'c0', '相'],
    ['red-shi', 'd0', '士'], ['red-jiang', 'e0', '帅'], ['red-shi', 'f0', '士'],
    ['red-xiang', 'g0', '相'], ['red-ma', 'h0', '马'], ['red-che', 'i0', '车'],
    ['red-pao', 'b2', '炮'], ['red-pao', 'h2', '炮'],
    ['red-bing', 'a3', '兵'], ['red-bing', 'c3', '兵'], ['red-bing', 'e3', '兵'],
    ['red-bing', 'g3', '兵'], ['red-bing', 'i3', '兵'],
    // 黑方
    ['black-che', 'a9', '車'], ['black-ma', 'b9', '馬'], ['black-xiang', 'c9', '象'],
    ['black-shi', 'd9', '士'], ['black-jiang', 'e9', '将'], ['black-shi', 'f9', '士'],
    ['black-xiang', 'g9', '象'], ['black-ma', 'h9', '馬'], ['black-che', 'i9', '車'],
    ['black-pao', 'b7', '炮'], ['black-pao', 'h7', '炮'],
    ['black-bing', 'a6', '卒'], ['black-bing', 'c6', '卒'], ['black-bing', 'e6', '卒'],
    ['black-bing', 'g6', '卒'], ['black-bing', 'i6', '卒'],
];

const SIDE_NAME = { red: '红', black: '黑' };

function statusText(message, color) {
    const el = document.getElementById('status');
    el.textContent = message;
    el.style.color = color || '#333';
}

function selectedLevel() {
    return parseInt(document.getElementById('level').value, 10);
}

function pieceColor(piece) {
    return piece.className.indexOf('black-') !== -1 ? 'black' : 'red';
}

/** 棋盘坐标 -> 屏幕像素坐标（含执黑时的翻转） */
function boardToPixel(pos) {
    let col = pos.charCodeAt(0) - 'a'.charCodeAt(0);
    let row = parseInt(pos.slice(1), 10);
    if (flipView) {              // 棋盘翻转：列 8-col、行 9-row
        col = 8 - col;
        row = 9 - row;
    }
    return {
        x: BOARD_PADDING + col * GRID_SIZE,
        y: BOARD_PADDING + (9 - row) * GRID_SIZE,
    };
}

function positionPiece(piece, pos) {
    const { x, y } = boardToPixel(pos);
    piece.style.left = `${x}px`;
    piece.style.top = `${y}px`;
    piece.style.zIndex = '100';
}

/** 在棋盘上标注最近一步：起点小圆点 + 终点圆环 */
let lastMarker = null;      // { from, to }

function showMoveMarker(fromPos, toPos) {
    lastMarker = { from: fromPos, to: toPos };
    const marks = [
        [document.getElementById('marker-from'), fromPos],
        [document.getElementById('marker-to'), toPos],
    ];
    marks.forEach(([el, pos]) => {
        const { x, y } = boardToPixel(pos);
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.display = 'block';
    });
}

function clearMoveMarker() {
    lastMarker = null;
    ['marker-from', 'marker-to'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });
}

function createPiece(cls, pos, text) {
    const div = document.createElement('div');
    div.className = `piece ${cls}`;
    div.setAttribute('data-position', pos);
    div.textContent = text;
    positionPiece(div, pos);
    return div;
}

function resetBoard() {
    const board = document.querySelector('.chessboard');
    board.querySelectorAll('.piece').forEach(p => p.remove());
    INITIAL_PIECES.forEach(([cls, pos, text]) => board.appendChild(createPiece(cls, pos, text)));
    selectedPiece = null;
}

/** 把棋子从 fromPos 挪到 toPos（吃子则移除目标棋子） */
function applyMoveToDom(fromPos, toPos) {
    const movingPiece = document.querySelector(`[data-position="${fromPos}"]`);
    const targetPiece = document.querySelector(`[data-position="${toPos}"]`);
    const capturedHTML = targetPiece ? targetPiece.outerHTML : null;
    if (targetPiece) targetPiece.remove();
    if (movingPiece) {
        movingPiece.setAttribute('data-position', toPos);
        positionPiece(movingPiece, toPos);
    }
    return capturedHTML;
}

/** 回滚一次走子，并恢复被吃的棋子 */
function undoMove(fromPos, toPos, capturedHTML) {
    applyMoveToDom(toPos, fromPos);
    if (capturedHTML) {
        const board = document.querySelector('.chessboard');
        const wrapper = document.createElement('div');
        wrapper.innerHTML = capturedHTML;
        const restored = wrapper.firstElementChild;
        positionPiece(restored, restored.getAttribute('data-position'));
        board.appendChild(restored);
    }
}

function selectPiece(piece) {
    if (selectedPiece) selectedPiece.classList.remove('selected');
    selectedPiece = piece;
    piece.classList.add('selected');
}

function deselectPiece() {
    if (selectedPiece) {
        selectedPiece.classList.remove('selected');
        selectedPiece = null;
    }
}

function updateSideButtons() {
    document.getElementById('btn-red').classList.toggle('active', playerSide === 'red');
    document.getElementById('btn-black').classList.toggle('active', playerSide === 'black');
}

/** 玩家走一步 -> 引擎自动应手 */
async function playerMove(fromPos, toPos) {
    if (busy) return;

    const prevMarker = lastMarker;
    const capturedHTML = applyMoveToDom(fromPos, toPos);
    showMoveMarker(fromPos, toPos);
    deselectPiece();
    busy = true;
    statusText('引擎思考中…', '#888');

    try {
        const response = await fetch('/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ move: fromPos + toPos }),
        });
        const data = await response.json();

        if (data.status === 'invalid') {
            undoMove(fromPos, toPos, capturedHTML);   // 非法走法回滚
            if (prevMarker) showMoveMarker(prevMarker.from, prevMarker.to);
            else clearMoveMarker();
            statusText(data.message || '非法走法', '#d9534f');
            busy = false;
            return;
        }

        if (data.move) {
            const aiFrom = data.move.substring(0, 2);
            const aiTo = data.move.substring(2, 4);
            setTimeout(() => {
                applyMoveToDom(aiFrom, aiTo);   // 稍作延迟，看得清
                showMoveMarker(aiFrom, aiTo);
            }, 400);
        }

        if (data.status === 'won') statusText(data.message, '#2e8b57');
        else if (data.status === 'lost') statusText(data.message, '#d9534f');
        else statusText(`轮到你走（执${SIDE_NAME[playerSide]}方）`, '#333');
    } catch (error) {
        console.error('Error:', error);
        undoMove(fromPos, toPos, capturedHTML);
        if (prevMarker) showMoveMarker(prevMarker.from, prevMarker.to);
        else clearMoveMarker();
        statusText('与引擎通信失败，请确认服务已启动', '#d9534f');
    }
    busy = false;
}

/** 开新局并与服务端同步（刷新页面时也会走这里，避免前后端状态错位） */
async function openNewGame(side) {
    if (busy) return;
    busy = true;
    playerSide = side;
    flipView = (side === 'black');   // 执黑时翻转棋盘，让黑方在下方
    document.querySelector('.chessboard').classList.toggle('flipped', flipView);
    updateSideButtons();
    clearMoveMarker();
    resetBoard();
    statusText('开新局中…', '#888');

    try {
        const response = await fetch('/new', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_side: side, max_depth: selectedLevel() }),
        });
        const data = await response.json();
        (data.moves || []).forEach(mv => {
            const from = mv.substring(0, 2);
            const to = mv.substring(2, 4);
            applyMoveToDom(from, to);
            showMoveMarker(from, to);   // 引擎执红先行
        });
        statusText(data.message || `你执${SIDE_NAME[side]}方`, '#333');
    } catch (error) {
        console.error('Error:', error);
        statusText('与引擎通信失败，请确认服务已启动', '#d9534f');
    }
    busy = false;
}

/** 调整引擎搜索深度，不重开对局 */
async function changeLevel(depth) {
    try {
        const response = await fetch('/level', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ max_depth: depth }),
        });
        const data = await response.json();
        statusText(data.message, data.status === 'invalid' ? '#d9534f' : '#333');
    } catch (error) {
        console.error('Error:', error);
        statusText('与引擎通信失败，请确认服务已启动', '#d9534f');
    }
}

function handleGlobalClick(event) {
    if (event.target.classList.contains('piece')) {
        event.stopPropagation();
        handlePieceClick(event);
        return;
    }
    const chessboard = document.querySelector('.chessboard');
    if (event.target === chessboard || event.target.classList.contains('board-grid')) {
        handleBoardClick(event);
    }
}

function handlePieceClick(event) {
    const piece = event.target;

    // 已选中自己的棋子，再点对方棋子 = 吃子
    if (selectedPiece && pieceColor(piece) !== playerSide) {
        playerMove(selectedPiece.getAttribute('data-position'), piece.getAttribute('data-position'));
        return;
    }

    if (pieceColor(piece) !== playerSide) {
        statusText(`那是对方的棋子，你执${SIDE_NAME[playerSide]}方`, '#d9534f');
        return;
    }

    if (selectedPiece === piece) deselectPiece();
    else selectPiece(piece);
}

function handleBoardClick(event) {
    if (!selectedPiece) return;
    const chessboard = document.querySelector('.chessboard');
    const rect = chessboard.getBoundingClientRect();
    const x = event.clientX - rect.left - BOARD_PADDING;
    const y = event.clientY - rect.top - BOARD_PADDING;

    let col = Math.round(x / GRID_SIZE);
    let row = 9 - Math.round(y / GRID_SIZE);
    if (flipView) {              // 翻转后要把屏幕坐标映射回逻辑坐标
        col = 8 - col;
        row = 9 - row;
    }

    if (col >= 0 && col < 9 && row >= 0 && row < 10) {
        const toPos = `${String.fromCharCode(97 + col)}${row}`;
        playerMove(selectedPiece.getAttribute('data-position'), toPos);
    }
}

window.addEventListener('load', () => {
    document.querySelectorAll('.piece').forEach(piece => {
        positionPiece(piece, piece.getAttribute('data-position'));
    });
    document.getElementById('btn-red').addEventListener('click', () => openNewGame('red'));
    document.getElementById('btn-black').addEventListener('click', () => openNewGame('black'));
    document.getElementById('level').addEventListener('change', e => changeLevel(e.target.value));
    document.addEventListener('click', handleGlobalClick, true);
    // 与服务端对齐：每次打开/刷新页面都开新局，避免服务端残留上一局局面
    openNewGame('red');
});
