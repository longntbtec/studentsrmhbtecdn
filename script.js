// Khởi tạo Supabase Client (supabaseUrl và supabaseKey đã được chuyển sang config.js)

let supabase = null;
try {
    if (window.supabase) {
        supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
        console.log('✅ Supabase initialized successfully!');
    } else {
        console.error('❌ Thư viện Supabase chưa được tải xuống tại window.supabase!');
        alert("⚠️ Không thể tải được thư viện Supabase! Vui lòng tải lại trang hoặc kiểm tra kết nối mạng.");
    }
} catch (err) {
    console.error('❌ Lỗi khởi tạo Supabase:', err);
}

// ══════════════════════════════════════════════════════════════════
//  SECTION 1 — SUPABASE & MOCK DATABASE (Tạm thời)
//
//  Đang trong quá trình chuyển đổi sang Supabase thực.
//  Dữ liệu Mock DB tạm giữ lại để tránh break UI trong lúc refactor.
//
//  Cấu trúc DB:
//  ┌──────────────────────────────────────────────────────────────┐
//  │ DB.accounts  : object key-value, key = mã truy cập (string) │
//  │   {code, name, role, rawRole, major, lop, is_active}        │
//  │ DB.students  : mảng object sinh viên                         │
//  │   {id, mssv, ho_ten, lop, status, updated_at}               │
//  │ DB.feedbacks : mảng object phản hồi                          │
//  │   {id, student_id, role, author_name, author_code,          │
//  │    content, reactions[], parent_id, created_at}             │
//  │ DB.nextStudentId / DB.nextFeedbackId : auto-increment id    │
//  └──────────────────────────────────────────────────────────────┘
//
//  Helper functions tạo timestamp tương đối:
//  – daysAgo(n)  : n ngày trước từ hiện tại
//  – hoursAgo(n) : n giờ trước từ hiện tại
//  – minsAgo(n)  : n phút trước từ hiện tại
// ══════════════════════════════════════════════════════════════════
const removeAccents = (str) => {
    if (!str) return '';
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
};
// [ĐÃ XÓA MOCK DATABASE] - App đang chuyển sang dùng Supabase.
// Các đoạn code dưới dùng DB.* sẽ được viết lại trong các bước tiếp theo.
// ══════════════════════════════════════════════════════════════════
//  SECTION 2 — APP STATE (Trạng thái toàn cục ứng dụng)
//
//  State lưu các giá trị tạm thời trong session hiện tại.
//  Mỗi lần logout → State.reset() dọn toàn bộ về mặc định.
//
//  Các trường:
//  – user            : thông tin người đang đăng nhập (null = chưa đăng nhập)
//  – statusFilter    : bộ lọc trạng thái đang chọn ('all'|'green'|'yellow'|'red'|'attention')
//  – currentStudentId: ID sinh viên đang mở trong modal
//  – replyParentId   : ID feedback đang reply (null = gửi bình luận gốc)
//  – pendingContent  : nội dung feedback đang chờ xác nhận lớp (class prompt)
//  – foundStudentId  : ID sinh viên được tìm thấy trong modal Add Student
//  – charts          : object chứa các Chart.js instance (để destroy khi cần vẽ lại)
// ══════════════════════════════════════════════════════════════════
const State = {
    user: null,
    statusFilter: 'all',
    currentStudentId: null,
    replyParentId: null,
    pendingContent: null,   // nội dung chờ xác nhận lớp
    foundStudentId: null,   // cho flow "tìm thấy SV" trong modal Add Student
    charts: {},
    students: [],           // Cache danh sách sinh viên lấy từ db
    rosterSelected: null,   // SV đã chọn từ roster autocomplete (cho modal Thêm SV)


    // Dọn dẹp toàn bộ state về giá trị ban đầu
    reset() {
        this.user = null; this.statusFilter = 'all';
        this.currentStudentId = null; this.replyParentId = null;
        this.pendingContent = null; this.foundStudentId = null;
        this.rosterSelected = null;
        // Hủy tất cả Chart.js instance để tránh memory leak
        Object.values(this.charts).forEach(c => c && c.destroy && c.destroy());
        this.charts = {};
    }
};

// ══════════════════════════════════════════════════════════════════
//  SECTION 3 — AUTH MODULE (Xác thực người dùng)
//
//  Luồng đăng nhập đơn giản (không có server):
//  1. Đọc mã từ input → tìm trong DB.accounts
//  2. Kiểm tra is_active
//  3. Lưu vào State.user
//  4. Ẩn loginScreen, hiện mainApp
//  5. Cập nhật UI (tên, role, tab Admin nếu là Admin)
//
//  quickLogin(code): điền mã vào input rồi gọi login() ngay
//  logout():         reset State, trở về màn hình đăng nhập
// ══════════════════════════════════════════════════════════════════
async function quickLogin(code) { document.getElementById('accessCode').value = code; await login(); }

function togglePassword() {
    const input = document.getElementById('accessCode');
    const icon = document.getElementById('eyeIcon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />`;
    } else {
        input.type = 'password';
        icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />`;
    }
}

async function login() {
    const inputField = document.getElementById('accessCode');
    const code = inputField.value.trim();
    if (!code) return; // Nếu trống thì bỏ qua

    // Vô hiệu hóa nút và hiện trạng thái loading thay đổi text
    const btn = document.querySelector('#loginScreen button');
    const oldText = btn.innerText;
    btn.innerText = '⏳ Đang kiểm tra...';
    btn.disabled = true;

    if (!supabase) { alert('❌ Không kết nối được Supabase!'); return; }

    // Truy vấn dữ liệu tài khoản từ Supabase (bảng accounts)
    const { data: acc, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('code', code)
        .single(); // Lấy đúng 1 dòng vì 'code' là Primary Key

    btn.innerText = oldText;
    btn.disabled = false;

    if (error || !acc) {
        console.error("Login lỗi:", error);
        alert('❌ Mã truy cập không hợp lệ!');
        return;
    }
    if (!acc.is_active) { alert('❌ Tài khoản đã bị vô hiệu hóa!'); return; }

    // Lưu thông tin user đăng nhập vào State
    // Chuyển đổi tên trường raw_role (DB) thành rawRole (Client) cho khớp các lệnh if-else cũ
    // Đảm bảo chữ cái đầu luôn viết hoa (vd: admin -> Admin, ctsv -> CTSV) để không bị lỗi phân quyền case-sensitive
    let rRole = acc.raw_role || '';
    if (rRole.toLowerCase() === 'admin') rRole = 'Admin';
    else if (rRole.toLowerCase() === 'ctsv') rRole = 'CTSV';
    else if (rRole.toLowerCase() === 'cnbm') rRole = 'CNBM';
    else if (rRole.toLowerCase() === 'gv') rRole = 'GV';

    State.user = {
        code: acc.code,
        name: acc.name,
        role: acc.role,
        rawRole: rRole,
        major: acc.major
    };

    // Chuyển UI từ màn hình đăng nhập sang ứng dụng chính
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('headerName').textContent = State.user.name;
    // Hiện role + bộ môn bên cạnh nếu là GV hoặc CNBM (vd: "Giảng viên · IT")
    const majorLabel = ['GV', 'CNBM'].includes(State.user.rawRole) && State.user.major
        ? ` · ${State.user.major}` : '';
    document.getElementById('headerRole').textContent = State.user.role + majorLabel;

    // Chỉ Admin mới thấy tab "Admin"
    if (State.user.rawRole === 'Admin')
        document.getElementById('tabAdmin').classList.remove('hidden');

    // Hiển thị bộ lọc Bộ môn nếu là Admin hoặc CTSV, hoặc CNBM quản lý >= 2 ngành
    const userMajors = State.user.major ? State.user.major.split(',').map(m => m.trim()).filter(Boolean) : [];
    if (['Admin', 'CTSV'].includes(State.user.rawRole) ||
        (State.user.rawRole === 'CNBM' && userMajors.length >= 2)) {
        const mf = document.getElementById('majorFilter');
        if (mf) mf.classList.remove('hidden');
    }

    // Nút đổi trạng thái trong modal chỉ hiện với Admin / GV / CTSV / CNBM
    if (['Admin', 'GV', 'CTSV', 'CNBM'].includes(State.user.rawRole))
        document.getElementById('statusBtns').style.display = 'flex';
    else
        document.getElementById('statusBtns').style.display = 'none';

    // Nút xóa sinh viên chỉ hiện với Admin
    if (State.user.rawRole === 'Admin')
        document.getElementById('btnDeleteStudent').style.display = 'block';
    else
        document.getElementById('btnDeleteStudent').style.display = 'none';

    // Ẩn checkbox "Cần CTSV hỗ trợ" đối với CTSV và Admin
    const escalateWrapper = document.getElementById('escalateCheckboxWrapper');
    if (escalateWrapper) {
        if (['CTSV', 'Admin'].includes(State.user.rawRole)) {
            escalateWrapper.style.display = 'none';
        } else {
            escalateWrapper.style.display = 'flex';
        }
    }

    initDashboard();
}

function logout() {
    State.reset();
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('accessCode').value = '';
    document.getElementById('tabAdmin').classList.add('hidden');
    switchTab('dashboard', true); // silent=true: không gọi renderAnalytics/renderAdmin
    document.getElementById('notifBadge').classList.add('hidden');
}

// ══════════════════════════════════════════════════════════════════
//  SECTION 4 — STUDENT MODULE (Quản lý danh sách sinh viên)
//
//  initDashboard()       : khởi tạo dashboard sau đăng nhập
//  updateStats()         : cập nhật 4 thẻ thống kê số lượng
//  populateClassFilter() : build dropdown lớp học từ DB.students
//  filterByStatus(s)     : lọc + highlight thẻ thống kê
//  renderStudents()      : lọc + sắp xếp + render danh sách SV
//  studentCard(s)        : tạo HTML cho 1 thẻ sinh viên
// ══════════════════════════════════════════════════════════════════
async function initDashboard() {
    const listEl = document.getElementById('studentList');
    if (listEl) listEl.innerHTML = '<div class="text-center text-slate-400 py-16 text-sm">⏳ Đang tải dữ liệu từ Supabase...</div>';

    // Kéo dữ liệu từ 3 bảng: students + (student_classes + feedbacks)
    const { data: stData, error } = await supabase
        .from('students')
        .select(`
            *,
            student_classes(class_name, author_code),
            feedbacks(id, content, created_at, role, author_code, reactions, parent_id)
        `)
        .order('updated_at', { ascending: false });

    if (error) {
        console.error("Lỗi khi load danh sách sinh viên:", error);
        if (listEl) listEl.innerHTML = '<div class="text-center text-rose-500 py-16 text-sm">❌ Lỗi tốc độ mạng hoặc Database.</div>';
        return;
    }

    // Load roster trước để lấy thông tin ngành
    await loadRoster();

    // Tiền xử lý dữ liệu để các bộ lọc UI cũ vẫn chạy đúng
    let processedStudents = (stData || []).map(s => {
        // Tìm tất cả các record của sinh viên này trong rosterCache (không phân biệt hoa thường)
        const rosterEntries = rosterCache ? rosterCache.filter(r => r.mssv.toLowerCase() === s.mssv.toLowerCase()) : [];
        const nganh = rosterEntries.length > 0 ? rosterEntries[0].nganh : 'Khác';

        let classSet = new Set();
        let monSet = new Set();
        let gvSet = new Set();
        rosterEntries.forEach(r => {
            if (r.lop) classSet.add(r.lop);
            if (r.ma_mon) monSet.add(r.ma_mon);
            if (r.giang_vien) gvSet.add(r.giang_vien);
        });
        (s.student_classes || []).forEach(c => { if (c.class_name) classSet.add(c.class_name); });

        const classStr = Array.from(classSet).join(', ');
        const monStr = Array.from(monSet).join(', ');
        const gvStr = Array.from(gvSet).join(', ');

        // Lấy feedback gần nhất làm preview
        const fbs = (s.feedbacks || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        return {
            ...s,
            lop: classStr,
            ma_mon: monStr,
            giang_vien: gvStr,
            nganh: nganh,
            latestFbContent: fbs[0] ? fbs[0].content : null,
            latestFbCreatedAt: fbs[0] ? fbs[0].created_at : null
        };
    });

    // Lọc sinh viên theo ngành (nếu user là CNBM và có cấu hình ngành - có thể nhiều ngành cách nhau bởi dấu phẩy)
    // Lưu ý: GV (Giảng viên) không bị lọc theo ngành vì họ có thể dạy sinh viên từ nhiều ngành khác nhau (VD: GV English dạy SV IT)
    if (State.user && State.user.rawRole === 'CNBM' && State.user.major) {
        const userMajors = State.user.major.split(',').map(m => m.trim()).filter(Boolean);
        processedStudents = processedStudents.filter(s => {
            const sMajors = (s.nganh || '').split(',').map(m => m.trim()).filter(Boolean);
            return sMajors.some(m => userMajors.includes(m));
        });
    }

    State.students = processedStudents;

    updateStats();
    populateClassFilter();
    populateMajorFilter();
    renderStudents();
    updateNotifBadge();
}

// Đếm số SV theo từng trạng thái và cập nhật vào 4 thẻ stat
function updateStats() {
    const all = State.students;
    document.getElementById('cntTotal').textContent = all.length;
    document.getElementById('cntGreen').textContent = all.filter(s => (s.status || 'green') === 'green').length;
    document.getElementById('cntYellow').textContent = all.filter(s => s.status === 'yellow').length;
    document.getElementById('cntRed').textContent = all.filter(s => s.status === 'red').length;
}

// Lấy tất cả tên lớp từ DB.students (SV có thể thuộc nhiều lớp),
// dùng Set để loại trùng, sort A-Z rồi đưa vào <select>
function populateClassFilter() {
    const majorF = document.getElementById('majorFilter') ? document.getElementById('majorFilter').value : 'all';

    // Nếu là CNBM thì lấy danh sách ngành quản lý (GV không bị giới hạn ngành)
    let userMajors = [];
    if (State.user && State.user.rawRole === 'CNBM' && State.user.major) {
        userMajors = State.user.major.split(',').map(m => m.trim()).filter(Boolean);
    }

    const set = new Set();
    const isGV = State.user && State.user.rawRole === 'GV';
    const ucode = isGV ? State.user.code.toLowerCase() : '';
    const uname = isGV ? State.user.name.toLowerCase() : '';

    const processRoster = (r) => {
        // BẢO MẬT: Giảng viên chỉ được lấy những lớp của các sinh viên mà họ có dạy
        if (isGV) {
            if (!r.giang_vien) return;
            const gvStr = r.giang_vien.toLowerCase();
            if (!gvStr.includes(ucode) && !gvStr.includes(uname)) return;
        }

        const sMajors = (r.nganh || '').split(',').map(m => m.trim()).filter(Boolean);
        // Lọc theo mảng ngành nếu là CNBM/GV, ngược lại lọc theo majorF từ dropdown
        if (userMajors.length > 0) {
            if (!sMajors.some(m => userMajors.includes(m))) return;
        } else if (majorF !== 'all') {
            if (!sMajors.includes(majorF)) return;
        }

        (r.lop || '').split(',')
            .map(c => c.trim().replace(/[{}\[\]()]/g, '').trim()).filter(Boolean)
            .forEach(c => {
                // Xác định xem "English" có được cho phép không
                const isEnglishAllowed = (userMajors.length > 0 && userMajors.includes('English')) || majorF === 'English' || majorF === 'all';
                if (c.toUpperCase().startsWith('ENT') && !isEnglishAllowed) return;
                set.add(c);
            });
    };

    if (rosterCache && rosterCache.length > 0) {
        rosterCache.forEach(processRoster);
    } else {
        State.students.forEach(processRoster);
    }

    const sel = document.getElementById('classFilter');
    const cur = sel.value; // giữ lại giá trị đang chọn
    sel.innerHTML = '<option value="all">🏫 Tất cả lớp</option>';
    [...set].sort().forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });

    if (cur !== 'all' && set.has(cur)) {
        sel.value = cur;
    } else {
        sel.value = 'all';
    }
}

function onMajorChange() {
    populateClassFilter();
    renderStudents();
}

// Lọc bộ môn dựa vào thuộc tính nganh lấy từ student_roster
function populateMajorFilter() {
    let userMajors = [];
    if (State.user && ['CNBM', 'GV'].includes(State.user.rawRole) && State.user.major) {
        userMajors = State.user.major.split(',').map(m => m.trim()).filter(Boolean);
    }

    const set = new Set();
    const processRoster = (r) => {
        if (!r.nganh) return;
        const sMajors = r.nganh.split(',').map(m => m.trim()).filter(Boolean);
        sMajors.forEach(m => {
            if (userMajors.length > 0) {
                if (userMajors.includes(m)) set.add(m);
            } else {
                set.add(m);
            }
        });
    };

    if (rosterCache && rosterCache.length > 0) {
        rosterCache.forEach(processRoster);
    } else {
        State.students.forEach(processRoster);
    }

    const sel = document.getElementById('majorFilter');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="all">📚 Tất cả bộ môn</option>';
    [...set].sort().forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); });
    if (cur !== 'all') sel.value = cur;
}

// Lọc theo trạng thái + highlight thẻ stat tương ứng bằng ring
function filterByStatus(s) {
    State.statusFilter = s;
    // Xóa highlight cũ khỏi tất cả thẻ
    ['statAll', 'statGreen', 'statYellow', 'statRed'].forEach(id =>
        document.getElementById(id).classList.remove('ring-2', 'ring-indigo-400', 'ring-emerald-400', 'ring-amber-400', 'ring-rose-400', 'shadow-md'));
    // Thêm highlight cho thẻ đang chọn
    const map = { all: ['statAll', 'ring-indigo-400'], green: ['statGreen', 'ring-emerald-400'], yellow: ['statYellow', 'ring-amber-400'], red: ['statRed', 'ring-rose-400'] };
    if (map[s]) document.getElementById(map[s][0]).classList.add('ring-2', map[s][1], 'shadow-md');
    renderStudents();
}

// Render danh sách SV với đầy đủ bộ lọc:
// 1. Sort: red → yellow → green, cùng status thì mới nhất lên đầu
// 2. Filter theo statusFilter (all / attention / green / yellow / red)
// 3. Filter theo lớp học (classFilter dropdown)
// 4. Filter theo từ khóa tìm kiếm (MSSV hoặc họ tên, case-insensitive)
function renderStudents() {
    const container = document.getElementById('studentList');
    const search = document.getElementById('searchInput').value.toLowerCase();
    const classF = document.getElementById('classFilter').value;
    const majorF = document.getElementById('majorFilter') ? document.getElementById('majorFilter').value : 'all';

    const getLatestTime = (s) => {
        const t1 = s.updated_at ? new Date(s.updated_at).getTime() : 0;
        const t2 = s.latestFbCreatedAt ? new Date(s.latestFbCreatedAt).getTime() : 0;
        return Math.max(t1, t2);
    };

    // Sort: Ưu tiên thẻ Đỏ lên đầu, sau đó mới sắp xếp theo thay đổi mới nhất
    let list = [...State.students].sort((a, b) => {
        const isRedA = a.status === 'red' ? 1 : 0;
        const isRedB = b.status === 'red' ? 1 : 0;
        if (isRedA !== isRedB) return isRedB - isRedA;
        return getLatestTime(b) - getLatestTime(a);
    });

    // BẢO MẬT: Giảng viên chỉ được xem sinh viên thuộc lớp mình dạy (dựa vào roster giang_vien)
    if (State.user.rawRole === 'GV') {
        const ucode = State.user.code.toLowerCase();
        const uname = State.user.name.toLowerCase();
        list = list.filter(s => {
            if (!s.giang_vien) return false;
            const gvStr = s.giang_vien.toLowerCase();
            return gvStr.includes(ucode) || gvStr.includes(uname);
        });
    }

    // Lọc theo bộ lọc trạng thái
    if (State.statusFilter === 'attention') {
        list = list.filter(s => s.latestFbContent && s.latestFbContent.includes('[CẦN CTSV HỖ TRỢ]'));
    }
    else if (State.statusFilter !== 'all') {
        list = list.filter(s => (s.status || 'green') === State.statusFilter);
    }

    // Lọc theo lớp (kiểm tra chuỗi lop phân tách bằng dấu phẩy)
    if (classF !== 'all') list = list.filter(s =>
        (s.lop || '').split(',').map(c => c.trim().replace(/[{}\[\]()]/g, '').trim()).includes(classF));

    // Lọc theo bộ môn
    if (majorF !== 'all') list = list.filter(s => {
        const sMajors = (s.nganh || '').split(',').map(m => m.trim()).filter(Boolean);
        return sMajors.includes(majorF);
    });

    // Lọc theo từ khóa
    if (search) {
        const q = removeAccents(search);
        list = list.filter(s =>
            removeAccents(s.mssv).includes(q) || removeAccents(s.ho_ten).includes(q)
        );
    }

    if (!list.length) {
        container.innerHTML = '<div class="text-center text-slate-400 py-16 text-sm">Không tìm thấy sinh viên nào</div>';
        return;
    }
    container.innerHTML = list.map(studentCard).join('');
}

// Tạo HTML string cho một thẻ sinh viên trong danh sách.
// Bao gồm: dải màu status, MSSV, tên, badge "Mới" (nếu cập nhật trong 30 phút),
// lớp học, preview phản hồi gần nhất, thời gian cập nhật.
function studentCard(s) {
    const st = s.status || 'green';
    const strip = { green: 'strip-green', yellow: 'strip-yellow', red: 'strip-red' }[st];
    const badge = { green: 'bg-emerald-100 text-emerald-700', yellow: 'bg-amber-100 text-amber-700', red: 'bg-rose-100 text-rose-700' }[st];
    const label = { green: 'Ổn định', yellow: 'Theo dõi', red: 'Cảnh báo' }[st];
    const emoji = { green: '🟢', yellow: '🟡', red: '🔴' }[st];

    const getLatestTime = (st) => {
        const t1 = st.updated_at ? new Date(st.updated_at).getTime() : 0;
        const t2 = st.latestFbCreatedAt ? new Date(st.latestFbCreatedAt).getTime() : 0;
        return Math.max(t1, t2);
    };
    const latestTime = getLatestTime(s);

    // Badge "Mới" xuất hiện nếu có thay đổi trong vòng 30 phút
    const recent = (Date.now() - latestTime) < 30 * 60 * 1000;

    // Lấy feedback gần nhất để preview từ trường đã map sẵn ở initDashboard
    const latestFbText = s.latestFbContent;
    const preview = latestFbText ? (latestFbText.length > 70 ? latestFbText.slice(0, 70) + '…' : latestFbText) : 'Chưa có phản hồi';

    // Hiển thị ngành đối với Admin và CTSV
    let majorsHtml = '';
    if (['Admin', 'CTSV'].includes(State.user.rawRole) && s.nganh) {
        const majors = s.nganh.split(',').map(m => m.trim()).filter(Boolean);
        if (majors.length === 1) {
            majorsHtml = `<span class="text-[10px] text-slate-400 italic whitespace-nowrap">${majors[0]}</span>`;
        } else {
            majorsHtml = `<div class="flex flex-col items-end gap-0.5">${majors.map(m => `<span class="text-[10px] text-slate-400 italic whitespace-nowrap">${m}</span>`).join('')}</div>`;
        }
    }

    return `
    <div onclick="openStudentModal(${s.id})"
        class="bg-white rounded-xl border border-slate-100 shadow-sm flex overflow-hidden hover:shadow-md transition-all cursor-pointer group">
        <!-- Dải màu trạng thái bên trái -->
        <div class="${strip} w-1.5 shrink-0"></div>
        <div class="flex-1 p-3.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
            <!-- MSSV -->
            <div class="sm:w-24 shrink-0">
                <p class="font-mono text-xs font-bold text-slate-400">${s.mssv}</p>
            </div>
            <!-- Tên + Badge "Mới" + Lớp + Chi tiết -->
            <div class="sm:w-56 shrink-0 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <p class="font-bold text-slate-800 group-hover:text-indigo-600 transition text-sm">${s.ho_ten}</p>
                    ${recent ? '<span class="badge-new">Mới</span>' : ''}
                </div>
                <p class="text-xs text-slate-400 mt-0.5 truncate">🏫 ${s.lop || 'N/A'}${s.ma_mon ? `<span class="hidden sm:inline"> · 📚 ${s.ma_mon}</span>` : ''}${s.giang_vien ? `<span class="hidden sm:inline"> · 👨‍🏫 ${s.giang_vien}</span>` : ''}</p>
            </div>
            <!-- Preview feedback (ẩn trên mobile) -->
            <div class="flex-1 min-w-0 hidden sm:block">
                <p class="text-xs text-slate-500 truncate">💬 ${preview}</p>
                ${s.latestFbCreatedAt ? `<p class="text-xs text-slate-300 mt-0.5">⏱️ ${timeAgo(s.latestFbCreatedAt)}</p>` : ''}
            </div>
            <!-- Ngành học -->
            ${majorsHtml ? `<div class="hidden lg:flex items-center gap-1.5 shrink-0 ml-2">${majorsHtml}</div>` : ''}
            <!-- Badge trạng thái + thời gian cập nhật -->
            <div class="flex items-center gap-2 shrink-0">
                <span class="text-xs font-semibold px-2.5 py-1 rounded-full ${badge}">${emoji} ${label}</span>
                <span class="text-xs text-slate-300 hidden sm:inline">⏱️ ${timeAgo(latestTime)}</span>
            </div>
        </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
//  SECTION 5 — STUDENT MODAL (Modal chi tiết sinh viên)
//
//  openStudentModal(id)  : mở modal, điền thông tin SV + render timeline
//  closeStudentModal()   : đóng modal, reset state liên quan
//  renderTimeline(id)    : render danh sách feedback theo cây (root + replies)
//  fbCard(fb, isReply)   : tạo HTML cho 1 bubble feedback
// ══════════════════════════════════════════════════════════════════
async function openStudentModal(id) {
    State.currentStudentId = id;
    const s = State.students.find(x => x.id === id);
    if (!s) return;

    // Điền thông tin vào header modal
    document.getElementById('modalName').textContent = s.ho_ten;
    document.getElementById('modalMeta').textContent = `${s.mssv} · ${s.lop || 'N/A'} · ${{ green: '🟢 Ổn định', yellow: '🟡 Theo dõi', red: '🔴 Cảnh báo' }[s.status || 'green']}`;
    // Dòng 2: chi tiết mã môn + GV (nhỏ hơn, không gây rối)
    const detailParts = [];
    if (s.ma_mon) detailParts.push(`📚 ${s.ma_mon}`);
    if (s.giang_vien) detailParts.push(`👨‍🏫 ${s.giang_vien}`);
    document.getElementById('modalDetail').textContent = detailParts.join(' · ');

    await renderTimeline(id);
    document.getElementById('studentModal').classList.add('active');
    document.getElementById('feedbackInput').focus(); // focus input để gõ nhanh
}

function closeStudentModal() {
    document.getElementById('studentModal').classList.remove('active');
    document.getElementById('classPromptOverlay').classList.remove('active');
    document.getElementById('feedbackInput').value = '';
    const escalateCb = document.getElementById('escalateCheckbox');
    if (escalateCb) escalateCb.checked = false;
    cancelReply();
    State.currentStudentId = null;
    State.replyParentId = null;
    State.pendingContent = null;
}

// Render timeline phản hồi dạng cây (Supabase):
async function renderTimeline(studentId) {
    const el = document.getElementById('feedbackTimeline');
    el.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">⏳ Đang tải phản hồi...</p>';

    // Fetch feedbacks kèm theo thông tin role, major từ bảng accounts
    const { data: allFbs, error } = await supabase
        .from('feedbacks')
        .select(`*, accounts(role, major)`)
        .eq('student_id', studentId);

    if (error || !allFbs || !allFbs.length) {
        el.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">Chưa có phản hồi nào</p>';
        return;
    }

    // Tách roots (parent_id = null) và replies, sort thời gian
    const visibleFbs = allFbs.filter(f => !f.reactions || !f.reactions.some(r => r.type === 'is_duplicate_agree'));
    const roots = visibleFbs.filter(f => !f.parent_id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    el.innerHTML = roots.map(fb => {
        const replies = visibleFbs.filter(r => r.parent_id === fb.id)
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        return fbCard(fb, false) +
            (replies.length
                ? `<div class="ml-7 pl-3 border-l-2 border-slate-200 space-y-2 mt-1.5">${replies.map(r => fbCard(r, true)).join('')}</div>`
                : '');
    }).join('');
}

// Tạo HTML bubble cho 1 feedback.
// Màu nền phân biệt theo role:
// – GV   → xanh dương (blue)
// – CNBM → tím (purple)
// – CTSV → xanh lá (emerald)
//
// Logic nút reaction (tim):
// – Nếu là feedback của chính mình: chỉ hiện số react, không có nút
// – Nếu là feedback người khác: nút toggle reaction, đổi icon ❤️/🤍
function fbCard(fb, isReply) {
    const isGV = fb.role === 'GV';
    const isCNBM = fb.role === 'CNBM';
    const bg = isGV ? 'bg-blue-50 border-blue-100' : isCNBM ? 'bg-purple-50 border-purple-100' : 'bg-emerald-50 border-emerald-100';
    const nc = isGV ? 'text-blue-700' : isCNBM ? 'text-purple-700' : 'text-emerald-700';
    const icon = isGV ? '👨‍🏫' : isCNBM ? '🎓' : '👤';
    const t = new Date(fb.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

    const agrees = (fb.reactions || []).filter(r => r.type === 'agree');
    const agreesText = agrees.length > 0 ? ` <span class="text-xs font-normal opacity-80">(+ ${agrees.map(a => a.name).join(', ')})</span>` : '';

    const likes = (fb.reactions || []).filter(r => r.type !== 'agree' && r.type !== 'is_duplicate_agree');
    const reacted = likes.some(r => r.code === State.user.code); // user đã like chưa?
    const isMyFb = fb.author_code === State.user.code;                        // đây là feedback của mình?
    const rCount = likes.length;

    const acc = fb.accounts;
    const roleLabel = acc
        ? (acc.major ? `${acc.role} · ${acc.major}` : acc.role)
        : fb.role; // fallback

    // Kiểm tra xem CNBM có cùng bộ môn với GV viết comment không
    const isSameMajor = (() => {
        if (!State.user.major || !acc || !acc.major) return false;
        const uMajors = State.user.major.split(',').map(m => m.trim());
        const fbMajors = acc.major.split(',').map(m => m.trim());
        return uMajors.some(m => fbMajors.includes(m));
    })();

    let finalContent = fb.content || '';
    let escalateBadge = '';
    let resolveBtn = '';

    if (finalContent.includes('[CẦN CTSV HỖ TRỢ]')) {
        finalContent = finalContent.replace('[CẦN CTSV HỖ TRỢ]', '').trim();
        escalateBadge = `<span class="bg-rose-100 text-rose-700 text-[10px] px-2 py-0.5 rounded uppercase font-bold mr-2 inline-flex items-center gap-1">📢 Cần hỗ trợ</span>`;
        // Hiển thị nút Đã giải quyết cho CTSV hoặc Admin
        if (State.user && (State.user.rawRole === 'CTSV' || State.user.rawRole === 'Admin') && !isReply) {
            resolveBtn = `<button onclick="resolveEscalation(${fb.id}, ${fb.student_id})" class="text-xs text-emerald-600 hover:text-emerald-700 font-bold px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 transition">✅ Đã giải quyết</button>`;
        }
    } else if (finalContent.includes('[CTSV ĐÃ XỬ LÝ]')) {
        finalContent = finalContent.replace('[CTSV ĐÃ XỬ LÝ]', '').trim();
        escalateBadge = `<span class="bg-emerald-100 text-emerald-700 text-[10px] px-2 py-0.5 rounded uppercase font-bold mr-2 inline-flex items-center gap-1">✅ Đã xử lý</span>`;
    }

    if (finalContent.includes('[GHI CHÚ XỬ LÝ]')) {
        finalContent = finalContent.replace('[GHI CHÚ XỬ LÝ]', '').trim();
    }

    const canEscalate = !isReply && !escalateBadge && (
        (State.user.rawRole === 'CNBM' && (isMyFb || isSameMajor)) ||
        (State.user.rawRole === 'GV' && isMyFb)
    );

    return `
    <div class="tl-item">
        <div class="border ${bg} rounded-xl p-3 ${isReply ? 'text-sm' : ''}">
            <div class="flex items-center justify-between mb-1.5">
                <div>
                    ${escalateBadge}
                    <span class="font-bold text-sm ${nc}">${icon} ${fb.author_name}${agreesText}</span>
                    <span class="block text-[11px] ${nc} opacity-60 font-medium ml-[22px] -mt-0.5">${roleLabel}</span>
                </div>
                <span class="text-xs text-slate-400">${t}</span>
            </div>
            <p class="text-slate-700 text-sm whitespace-pre-wrap leading-relaxed">${finalContent}</p>
            <div class="flex items-center justify-end gap-3 mt-2 pt-2 border-t border-white/60">
                ${resolveBtn}
                <!-- Nút "Trả lời" chỉ hiện ở feedback gốc, không hiện ở reply -->
                ${!isReply ? `<button onclick="replyTo(${fb.id},'${fb.author_name}')" class="text-xs text-slate-400 hover:text-indigo-600 transition">↪️ Trả lời</button>` : ''}
                <!-- Nút "Cùng ý kiến" chỉ hiện ở feedback gốc, không phải của chính mình, và chỉ dành cho GV/CNBM -->
                ${!isReply && ['GV', 'CNBM'].includes(State.user.rawRole) && !['CTSV', 'Admin'].includes(fb.role) && fb.author_code !== State.user.code && !agrees.some(a => a.code === State.user.code) ? `<button onclick="agreeWithFeedback(${fb.id})" class="text-xs text-slate-400 hover:text-emerald-600 transition">🤝 Cùng comment</button>` : ''}
                <!-- Nút "Báo CTSV hỗ trợ" (CNBM báo cáo hộ GV, hoặc GV tự báo cáo bài của mình) -->
                ${canEscalate ? `<button onclick="escalateFeedback(${fb.id}, ${fb.student_id})" class="text-xs text-rose-500 hover:text-rose-700 transition">📢 Nhờ CTSV hỗ trợ</button>` : ''}
                <!-- Nút reaction: tất cả mọi người đều có quyền thả tim -->
                <button onclick="toggleReaction(${fb.id})" class="reaction-btn ${reacted ? 'reacted' : ''}">
                    <span>${reacted ? '❤️' : '🤍'}</span>
                    ${rCount > 0 ? `<span class="font-semibold text-slate-500">${rCount}</span>` : ''}
                </button>
            </div>
        </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
//  SECTION 6 — FEEDBACK MODULE (Gửi phản hồi)
//
//  sendFeedback()     : validate → kiểm tra GV lần đầu → doSend hoặc classPrompt
//  confirmClass()     : xác nhận lớp học, cập nhật SV, rồi gọi doSend
//  skipClass()        : bỏ qua bước hỏi lớp, gọi doSend ngay
//  doSend(content)    : thực sự push feedback vào DB, cập nhật UI
//  replyTo(id, name)  : cài chế độ reply (hiện replyBar, set State.replyParentId)
//  cancelReply()      : hủy chế độ reply
//  toggleReaction(id) : toggle like/unlike cho 1 feedback
// ══════════════════════════════════════════════════════════════════

// Cùng comment với một phản hồi khác (ghi nhận vào báo cáo)
async function agreeWithFeedback(parentId) {
    if (window.isAgreeing) return;
    window.isAgreeing = true;
    
    // Lấy nội dung comment gốc
    const { data: parentFb } = await supabase.from('feedbacks').select('*').eq('id', parentId).single();
    if (!parentFb) { window.isAgreeing = false; return; }

    const reactions = parentFb.reactions || [];
    if (reactions.some(r => r.code === State.user.code && r.type === 'agree')) {
        window.isAgreeing = false;
        return;
    }

    // 1. Thêm người đồng ý vào danh sách reactions của comment gốc
    reactions.push({ code: State.user.code, name: State.user.name, type: 'agree' });
    await supabase.from('feedbacks').update({ reactions: reactions }).eq('id', parentId);

    // 2. Tạo một bản sao comment cho chính GV này để xuất báo cáo (bị ẩn trong timeline)
    const nowISO = new Date().toISOString();
    await supabase.from('feedbacks').insert([{
        student_id: State.currentStudentId,
        role: State.user.rawRole,
        author_name: State.user.name,
        author_code: State.user.code,
        content: parentFb.content,
        parent_id: null,
        reactions: [{ type: 'is_duplicate_agree' }]
    }]);

    await supabase.from('students').update({ updated_at: nowISO }).eq('id', State.currentStudentId);

    await renderTimeline(State.currentStudentId);
    await initDashboard();
    
    window.isAgreeing = false;
}

async function sendFeedback() {
    const content = document.getElementById('feedbackInput').value.trim();
    if (!content || !State.currentStudentId) return;

    // Giảng viên tiếp theo không cần nhập lớp đang dạy nữa vì thông tin lớp đã hiện đầy đủ từ danh sách kỳ học.
    await doSend(content);
}

// Xử lý CTSV Đánh dấu đã giải quyết
async function resolveEscalation(fbId, studentId) {
    const note = prompt('Nhập ghi chú xử lý (Bắt buộc - VD: Đã gọi điện cho phụ huynh):');
    if (!note || !note.trim()) {
        alert('Bạn phải nhập ghi chú xử lý để tiếp tục!');
        return;
    }

    // 1. Quét và đổi tất cả cờ đỏ thành cờ xanh cho SV này (bao gồm cả các bản sao "Cùng comment")
    const { data: fbs } = await supabase.from('feedbacks').select('id, content').eq('student_id', studentId).like('content', '%[CẦN CTSV HỖ TRỢ]%');
    if (fbs && fbs.length > 0) {
        for (let fb of fbs) {
            const newContent = fb.content.replace('[CẦN CTSV HỖ TRỢ]', '[CTSV ĐÃ XỬ LÝ]');
            await supabase.from('feedbacks').update({ content: newContent }).eq('id', fb.id);
        }
    }

    // 2. Chèn 1 comment mang danh nghĩa CTSV với nội dung ghi chú (Comment độc lập)
    const nowISO = new Date().toISOString();
    await supabase.from('feedbacks').insert([{
        student_id: studentId,
        author_code: State.user.code,
        author_name: State.user.name,
        role: State.user.rawRole,
        content: `[GHI CHÚ XỬ LÝ] ${note.trim()}`,
        parent_id: null // Sửa thành null để trở thành thông báo chung cho toàn bộ sinh viên thay vì reply riêng lẻ
    }]);

    await supabase.from('students').update({ updated_at: nowISO }).eq('id', studentId);

    // 3. Làm mới UI
    await renderTimeline(studentId);
    await initDashboard();
}

// Xử lý khi GV xác nhận lớp trong popup:
// – Parse chuỗi lop hiện tại, thêm lớp mới nếu chưa có
// – Cập nhật modalMeta và dropdown classFilter
// – Đóng overlay, gọi doSend với nội dung đang chờ
async function confirmClass() {
    const lop = document.getElementById('classPromptInput').value.trim();
    if (lop && State.currentStudentId) {
        // Lưu thông tin lớp vào Supabase
        await supabase.from('student_classes').insert([{
            student_id: State.currentStudentId,
            author_code: State.user.code,
            class_name: lop
        }]);
    }
    document.getElementById('classPromptOverlay').classList.remove('active');
    await doSend(State.pendingContent);
    State.pendingContent = null;
}

// Bỏ qua bước hỏi lớp → gửi feedback ngay
async function skipClass() {
    document.getElementById('classPromptOverlay').classList.remove('active');
    await doSend(State.pendingContent);
    State.pendingContent = null;
}

// Thực sự tạo feedback object và push vào Supabase DB,
// sau đó cập nhật updated_at của sinh viên và refresh toàn bộ UI liên quan.
async function doSend(content) {
    const btn = document.getElementById('btnSubmitFeedback');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }

    const escalateCb = document.getElementById('escalateCheckbox');
    if (escalateCb && escalateCb.checked) {
        content = '[CẦN CTSV HỖ TRỢ] ' + content;
    }

    // Nếu CTSV hoặc Admin viết comment gốc, tự động giải quyết các yêu cầu hỗ trợ cũ
    if ((State.user.rawRole === 'CTSV' || State.user.rawRole === 'Admin') && !State.replyParentId) {
        const { data: fbs } = await supabase.from('feedbacks')
            .select('id, content')
            .eq('student_id', State.currentStudentId)
            .like('content', '%[CẦN CTSV HỖ TRỢ]%');
        
        if (fbs && fbs.length > 0) {
            for (let fb of fbs) {
                const newContent = fb.content.replace('[CẦN CTSV HỖ TRỢ]', '[CTSV ĐÃ XỬ LÝ]');
                await supabase.from('feedbacks').update({ content: newContent }).eq('id', fb.id);
            }
        }
    }

    // Tính timestamp hiện tại (Cập nhật updatedAt cho thẻ SV)
    const nowISO = new Date().toISOString();

    // 1. Insert Feedback
    await supabase.from('feedbacks').insert([{
        student_id: State.currentStudentId,
        role: State.user.rawRole,
        author_name: State.user.name,
        author_code: State.user.code,
        content: content,
        parent_id: State.replyParentId || null
    }]);

    // 2. Cập nhật updated_at của SV để nó nhảy lên đầu danh sách dashboard
    await supabase.from('students').update({ updated_at: nowISO }).eq('id', State.currentStudentId);

    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }

    document.getElementById('feedbackInput').value = '';
    cancelReply();
    await renderTimeline(State.currentStudentId); // fetch lại timeline từ DB
    await initDashboard();                        // refresh data ds sinh viên ngầm
}

// Nút bấm "Nhờ CTSV hỗ trợ" cho GV nếu quên tick lúc đăng
window.escalateFeedback = async (fbId, studentId) => {
    if (!confirm('Bạn muốn chuyển bình luận này thành yêu cầu CTSV hỗ trợ?')) return;

    // 1. Cập nhật lại nội dung feedback
    const { data: fbData, error: errGet } = await supabase.from('feedbacks').select('content').eq('id', fbId).single();
    if (errGet || !fbData) return alert('Lỗi truy xuất bình luận');
    
    const newContent = '[CẦN CTSV HỖ TRỢ] ' + (fbData.content || '');
    const { error: errUpdate } = await supabase.from('feedbacks').update({ content: newContent }).eq('id', fbId);
    if (errUpdate) return alert('Lỗi cập nhật bình luận');

    // 2. Cập nhật student_roster để nổi cờ lên màn hình CTSV
    await supabase.from('student_roster').update({
        latestFb: new Date().toISOString(),
        latestFbContent: newContent
    }).eq('id', studentId);

    // 3. Render lại
    renderTimeline(studentId);
    renderStudents();
};

window.replyTo = (id, name) => {
    State.replyParentId = id;
    document.getElementById('replyBar').classList.remove('hidden');
    document.getElementById('replyName').textContent = name;
    document.getElementById('feedbackInput').placeholder = `Trả lời ${name}...`;
    document.getElementById('feedbackInput').focus();
}

// Tắt chế độ reply: reset State và UI input
function cancelReply() {
    State.replyParentId = null;
    document.getElementById('replyBar').classList.add('hidden');
    document.getElementById('feedbackInput').placeholder = 'Nhập phản hồi...';
}

// Toggle like/unlike: nếu đã react thì xóa, chưa thì thêm vào mảng reactions
// Toggle like/unlike trực tiếp trên Supabase
async function toggleReaction(fbId) {
    // Tạm lấy danh sách cũ thẳng từ DB ra để tính
    const { data: fb } = await supabase.from('feedbacks').select('reactions').eq('id', fbId).single();
    if (!fb) return;

    let reactions = fb.reactions || [];
    const i = reactions.findIndex(r => r.code === State.user.code && r.type !== 'agree' && r.type !== 'is_duplicate_agree');
    if (i > -1) reactions.splice(i, 1);
    else reactions.push({ role: State.user.rawRole, code: State.user.code, name: State.user.name });

    await supabase.from('feedbacks').update({ reactions: reactions }).eq('id', fbId);
    await renderTimeline(State.currentStudentId); // re-render 
    await initDashboard(); // refresh notifications and dashboard
}

// ══════════════════════════════════════════════════════════════════
//  SECTION 7 — STATUS UPDATE (Cập nhật trạng thái sinh viên)
//
//  updateStatus(newSt): thay đổi status của SV đang mở trong modal.
//  – Yêu cầu nhập lý do (không được để trống)
//  – Tự động tạo 1 feedback hệ thống ghi nhận thay đổi
//    (ví dụ: "[🔴 Cảnh báo] Nghỉ học nhiều")
//  – Nếu chuyển sang 'red' lần đầu → tăng badge thông báo
// ══════════════════════════════════════════════════════════════════
async function updateStatus(newSt) {
    if (!State.currentStudentId) return;
    const reason = prompt('Lý do thay đổi trạng thái (bắt buộc):');
    if (!reason?.trim()) { alert('Cần nhập lý do!'); return; }

    const s = State.students.find(x => x.id === State.currentStudentId);
    if (!s) return;

    const old = s.status;
    const nowISO = new Date().toISOString();

    const emoji = { green: '🟢', yellow: '🟡', red: '🔴' }[newSt];
    const text = { green: 'Ổn định', yellow: 'Theo dõi', red: 'Cảnh báo' }[newSt];

    // Cập nhật trạng thái SV trên DB
    await supabase.from('students')
        .update({ status: newSt, updated_at: nowISO })
        .eq('id', State.currentStudentId);

    // Tạo feedback hệ thống ghi lại lý do thay đổi trạng thái
    await supabase.from('feedbacks').insert([{
        student_id: State.currentStudentId,
        role: State.user.rawRole,
        author_name: State.user.name,
        author_code: State.user.code,
        content: `[${emoji} ${text}] ${reason}`,
        parent_id: null
    }]);

    // Cập nhật dòng meta trong header modal
    document.getElementById('modalMeta').textContent =
        `${s.mssv} · ${s.lop || 'N/A'} · ${emoji} ${text}`;

    // Badge count will be updated dynamically via initDashboard() below

    await renderTimeline(State.currentStudentId);
    await initDashboard();
}

// Xóa sinh viên khỏi danh sách (Chỉ dành cho Admin)
async function deleteStudent() {
    if (!State.currentStudentId || State.user.rawRole !== 'Admin') return;

    if (!confirm('Hành động này sẽ XÓA VĨNH VIỄN sinh viên này cùng toàn bộ lịch sử phản hồi khỏi danh sách. Bạn có chắc chắn muốn tiếp tục?')) return;

    const btn = document.getElementById('btnDeleteStudent');
    const oldText = btn.innerHTML;
    btn.innerHTML = '⏳';
    btn.disabled = true;

    // Xóa lần lượt từ bảng con đến bảng cha để tránh lỗi foreign key constraint (nếu chưa set cascade)
    await supabase.from('feedbacks').delete().eq('student_id', State.currentStudentId);
    await supabase.from('student_classes').delete().eq('student_id', State.currentStudentId);

    const { error } = await supabase.from('students').delete().eq('id', State.currentStudentId);

    btn.innerHTML = oldText;
    btn.disabled = false;

    if (error) {
        console.error("Lỗi xóa sinh viên:", error);
        alert('❌ Lỗi khi xóa sinh viên: ' + error.message);
        return;
    }

    closeStudentModal();
    await initDashboard();
}

// ══════════════════════════════════════════════════════════════════
//  SECTION 8 — ADD STUDENT MODULE (Thêm sinh viên mới)
//
//  Luồng MỚI (v2.1):
//  – Mặc định: GV tìm SV từ bảng student_roster (autocomplete)
//    → Chọn SV → MSSV + Tên + Lớp tự điền → Nhấn Thêm
//  – Fallback: Toggle "Nhập tay" → nhập MSSV + Tên + Lớp thủ công
//  – createStudent(): kiểm tra trùng MSSV trước khi tạo
//
//  Roster functions:
//  – loadRoster()          : tải danh sách SV từ student_roster (1 lần)
//  – onRosterSearch()      : lọc roster client-side, render dropdown
//  – selectFromRoster(item): chọn SV, lưu vào State.rosterSelected
//  – clearRosterSelection(): bỏ chọn, quay lại trạng thái tìm
//  – toggleManualMode()    : chuyển giữa roster search ↔ nhập tay
// ══════════════════════════════════════════════════════════════════

// Cache danh sách roster để tìm client-side (load 1 lần)
let rosterCache = [];
let rosterLoaded = false;

// Tải toàn bộ student_roster từ Supabase (392 SV ≈ 30KB, rất nhẹ)
async function loadRoster() {
    if (rosterLoaded) return;
    const { data, error } = await supabase
        .from('student_roster')
        .select('mssv, ho_ten, lop, ma_mon, giang_vien, nganh')
        .order('mssv');
    if (!error && data) {
        rosterCache = data;
        rosterLoaded = true;
        console.log(`📋 Roster loaded: ${data.length} SV`);
    } else {
        console.warn('⚠️ Không tải được roster:', error);
    }
}

// Xử lý sự kiện gõ trong ô tìm kiếm roster
function onRosterSearch() {
    const query = document.getElementById('rosterSearchInput').value.trim();
    const dropdown = document.getElementById('rosterDropdown');

    if (query.length < 2) {
        dropdown.classList.remove('active');
        return;
    }

    const q = removeAccents(query);
    let results = rosterCache
        .filter(r => removeAccents(r.mssv).includes(q) || removeAccents(r.ho_ten).includes(q));

    // Chỉ cho phép tìm SV trong cùng ngành nếu user là GV/CNBM và có khai báo major (hỗ trợ nhiều ngành)
    if (['GV', 'CNBM'].includes(State.user.rawRole) && State.user.major) {
        const userMajors = State.user.major.split(',').map(m => m.trim()).filter(Boolean);
        results = results.filter(r => {
            const sMajors = (r.nganh || '').split(',').map(m => m.trim()).filter(Boolean);
            return sMajors.some(m => userMajors.includes(m));
        });
    }

    // BẢO MẬT: Giảng viên chỉ được tìm sinh viên thuộc lớp mình dạy (dựa vào roster giang_vien)
    if (State.user.rawRole === 'GV') {
        const ucode = State.user.code.toLowerCase();
        const uname = State.user.name.toLowerCase();
        results = results.filter(r => {
            if (!r.giang_vien) return false;
            const gvStr = r.giang_vien.toLowerCase();
            return gvStr.includes(ucode) || gvStr.includes(uname);
        });
    }

    results = results.slice(0, 8);

    if (results.length === 0) {
        dropdown.innerHTML = '<div class="px-4 py-3 text-sm text-slate-400 text-center">Không tìm thấy SV nào</div>';
        dropdown.classList.add('active');
        return;
    }

    dropdown.innerHTML = results.map((r, i) => `
                <div class="roster-item" onclick="selectFromRoster(${i}, '${encodeURIComponent(JSON.stringify(r))}')">
                    <div><span class="ri-mssv">${r.mssv}</span><span class="ri-name">${r.ho_ten}</span></div>
                    <div class="ri-meta">${r.lop || '—'} · ${r.nganh || '—'}</div>
                </div>
            `).join('');
    dropdown.classList.add('active');
}

// Khi chọn 1 SV từ dropdown roster
function selectFromRoster(idx, encodedJson) {
    const item = JSON.parse(decodeURIComponent(encodedJson));

    // Lưu vào State
    State.rosterSelected = item;

    // Hiện thông tin đã chọn
    document.getElementById('selectedName').textContent = item.ho_ten;
    document.getElementById('selectedMeta').textContent =
        `${item.mssv} · ${item.lop || '—'} · ${item.nganh || '—'}`;
    document.getElementById('rosterSelectedInfo').classList.remove('hidden');

    // Ẩn dropdown + clear ô tìm
    document.getElementById('rosterDropdown').classList.remove('active');
    document.getElementById('rosterSearchInput').value = '';
}

// Bỏ chọn SV roster
function clearRosterSelection() {
    State.rosterSelected = null;
    document.getElementById('rosterSelectedInfo').classList.add('hidden');
    document.getElementById('rosterSearchInput').value = '';
    document.getElementById('rosterSearchInput').focus();
}

// Mở modal: reset UI, load roster, focus ô tìm
async function openAddStudentModal() {
    State.rosterSelected = null;
    document.getElementById('rosterSearchInput').value = '';
    document.getElementById('rosterDropdown').classList.remove('active');
    document.getElementById('rosterSelectedInfo').classList.add('hidden');
    const authorInput = document.getElementById('newAuthorCode');
    authorInput.value = State.user.code || '';

    // Khóa không cho GV đổi mã GV phụ trách
    if (State.user.rawRole === 'GV') {
        authorInput.readOnly = true;
        authorInput.classList.add('bg-slate-50', 'text-slate-500', 'cursor-not-allowed');
        document.getElementById('authorCodeHelper').textContent = 'Mã của bạn (không thể thay đổi).';
    } else {
        authorInput.readOnly = false;
        authorInput.classList.remove('bg-slate-50', 'text-slate-500', 'cursor-not-allowed');
        document.getElementById('authorCodeHelper').textContent = 'Có thể sửa nếu bạn (Admin/CTSV/CNBM) nhập hộ GV.';
    }

    document.getElementById('initialFeedback').value = '';
    document.getElementById('initialStatus').value = '';
    document.getElementById('duplicateWarning').classList.add('hidden');

    document.getElementById('addStudentModal').classList.add('active');
    await loadRoster();
    document.getElementById('rosterSearchInput').focus();
}

function closeAddStudentModal() {
    document.getElementById('addStudentModal').classList.remove('active');
}

// Ẩn cảnh báo trùng MSSV khi user bắt đầu sửa lại ô MSSV
function clearDupWarning() {
    document.getElementById('duplicateWarning').classList.add('hidden');
}

// Tạo SV mới: đọc từ roster đã chọn
async function createStudent() {
    if (!State.rosterSelected) {
        alert('Vui lòng chọn sinh viên từ danh sách trước khi thêm.');
        document.getElementById('rosterSearchInput').focus();
        return;
    }

    if (State.user.rawRole === 'GV') {
        const ucode = State.user.code.toLowerCase();
        const uname = State.user.name.toLowerCase();
        const gvStr = (State.rosterSelected.giang_vien || '').toLowerCase();
        if (!gvStr.includes(ucode) && !gvStr.includes(uname)) {
            alert('Bạn chỉ có thể thêm sinh viên thuộc lớp bạn đang giảng dạy!');
            return;
        }
    }

    const feedback = document.getElementById('initialFeedback').value.trim();
    if (!feedback) {
        alert('Vui lòng nhập Feedback / Lý do thêm vào danh sách chăm sóc.');
        document.getElementById('initialFeedback').focus();
        return;
    }

    const initialStatus = document.getElementById('initialStatus').value;
    if (!initialStatus) {
        alert('Vui lòng chọn Trạng thái ban đầu.');
        document.getElementById('initialStatus').focus();
        return;
    }

    const mssv = State.rosterSelected.mssv;
    const name = State.rosterSelected.ho_ten;
    const lop = State.rosterSelected.lop || '';
    const authorCode = document.getElementById('newAuthorCode').value.trim();

    const btn = document.querySelector('#addStudentModal button[onclick="createStudent()"]');
    const oldText = btn.innerText;
    btn.innerText = '⏳ Đang lưu...';
    btn.disabled = true;

    // 1. Kiểm tra MSSV trên DB
    const { data: dupData, error: err0 } = await supabase
        .from('students')
        .select('ho_ten, id')
        .eq('mssv', mssv)
        .maybeSingle();

    if (dupData) {
        alert(`Sinh viên ${mssv} - ${dupData.ho_ten} đã có trong danh sách chăm sóc! Hệ thống sẽ mở ngay hồ sơ của sinh viên này.`);
        btn.innerText = oldText;
        btn.disabled = false;
        closeAddStudentModal();
        openStudentModal(dupData.id);
        return;
    }

    // 2. Insert vào bảng students
    const { data: newStu, error: err1 } = await supabase
        .from('students')
        .insert([{ mssv, ho_ten: name, status: initialStatus }])
        .select()
        .single();

    if (err1) {
        console.error("Lỗi khi thêm sinh viên:", err1);
        alert("Lỗi khi thêm sinh viên: " + err1.message);
        btn.innerText = oldText; btn.disabled = false;
        return;
    }

    // 3. Gắn lớp (nếu có)
    if (lop) {
        const { error: err2 } = await supabase
            .from('student_classes')
            .insert([{
                student_id: newStu.id,
                author_code: authorCode || State.user.code,
                class_name: lop
            }]);
        if (err2) console.error("Lỗi thêm vào student_classes:", err2);
    }

    // 4. Lưu feedback ban đầu
    const { error: err3 } = await supabase
        .from('feedbacks')
        .insert([{
            student_id: newStu.id,
            author_code: State.user.code,
            author_name: State.user.name,
            role: State.user.rawRole,
            content: feedback
        }]);
    if (err3) console.error("Lỗi thêm feedback ban đầu:", err3);

    btn.innerText = oldText;
    btn.disabled = false;

    // 5. Load lại Dashboard
    await initDashboard();
    closeAddStudentModal();
}

// Đóng dropdown roster khi click ra ngoài
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('rosterDropdown');
    const input = document.getElementById('rosterSearchInput');
    if (dropdown && input && !dropdown.contains(e.target) && e.target !== input) {
        dropdown.classList.remove('active');
    }
});

// ══════════════════════════════════════════════════════════════════
//  SECTION 9 — ANALYTICS MODULE (Biểu đồ thống kê)
//
//  renderAnalytics(): vẽ lại 3 biểu đồ mỗi khi chuyển sang tab Analytics.
//  Trước khi vẽ mới, hủy (destroy) các instance cũ để tránh memory leak.
//
//  3 biểu đồ:
//  1. Donut (doughnut): phân bổ green/yellow/red
//     – Dữ liệu động từ DB.students
//  2. Bar (stacked bar): số SV theo từng lớp
//     – Parse chuỗi lop → nhóm theo lớp → xếp chồng theo status
//  3. Line (xu hướng): số cảnh báo theo tuần
//     – Hardcoded mock data (6 tuần, 2 series: Cảnh báo + Theo dõi)
// ══════════════════════════════════════════════════════════════════
function renderAnalytics() {
    // Hủy chart cũ để tránh lỗi "canvas already in use"
    Object.values(State.charts).forEach(c => c?.destroy?.());
    State.charts = {};

    // ── Chuẩn bị dữ liệu ──
    let userMajors = [];
    if (State.user && ['CNBM', 'GV'].includes(State.user.rawRole) && State.user.major) {
        userMajors = State.user.major.split(',').map(m => m.trim()).filter(Boolean);
    }

    const all = State.students; // SV đã có feedback
    const studentsWithFeedback = all.length;
    const gAll = all.filter(s => (s.status || 'green') === 'green').length;
    const yAll = all.filter(s => s.status === 'yellow').length;
    const rAll = all.filter(s => s.status === 'red').length;

    let totalRoster = 0;
    if (rosterCache && rosterCache.length > 0) {
        rosterCache.forEach(s => {
            if (!s.nganh) return;
            const sMajors = s.nganh.split(',').map(m => m.trim()).filter(Boolean);
            if (userMajors.length > 0 && !sMajors.some(m => userMajors.includes(m))) return;
            totalRoster++;
        });
    }
    const studentsWithoutFeedback = Math.max(0, totalRoster - studentsWithFeedback);
    const coveragePct = totalRoster > 0 ? ((studentsWithFeedback / totalRoster) * 100).toFixed(1) : '0.0';

    // ── Cập nhật 4 thẻ KPI ──
    const kpiTotal = document.getElementById('kpiTotal');
    const kpiFb = document.getElementById('kpiFeedback');
    const kpiY = document.getElementById('kpiYellow');
    const kpiR = document.getElementById('kpiRed');
    if (kpiTotal) kpiTotal.textContent = totalRoster;
    if (kpiFb) kpiFb.textContent = studentsWithFeedback;
    if (kpiY) kpiY.textContent = yAll;
    if (kpiR) kpiR.textContent = rAll;

    // ── Plugin hiển thị số % ở giữa donut ──
    const centerTextPlugin = {
        id: 'centerText',
        beforeDraw(chart) {
            const { ctx, width, height } = chart;
            const meta = chart.getDatasetMeta(0);
            if (!meta || meta.data.length === 0) return;
            const txt = chart.config.options.plugins.centerText?.text || '';
            const sub = chart.config.options.plugins.centerText?.sub || '';
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // Số chính
            ctx.font = 'bold 28px Inter, sans-serif';
            ctx.fillStyle = '#334155';
            ctx.fillText(txt, width / 2, height / 2 - 8);
            // Nhãn phụ
            if (sub) {
                ctx.font = '500 11px Inter, sans-serif';
                ctx.fillStyle = '#94a3b8';
                ctx.fillText(sub, width / 2, height / 2 + 16);
            }
            ctx.restore();
        }
    };

    // ── 1. Donut: Độ bao phủ Feedback ──
    State.charts.coverageDonut = new Chart(document.getElementById('coverageDonutChart'), {
        type: 'doughnut',
        plugins: [centerTextPlugin],
        data: {
            labels: ['Đã có Feedback', 'Chưa có Feedback'],
            datasets: [{
                data: [studentsWithFeedback, studentsWithoutFeedback],
                backgroundColor: ['#6366f1', '#e2e8f0'],
                borderWidth: 0, hoverOffset: 6, cutout: '68%'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                centerText: { text: coveragePct + '%', sub: 'bao phủ' },
                legend: { position: 'bottom', labels: { font: { family: 'Inter', size: 12 }, padding: 16, usePointStyle: true, pointStyleWidth: 10 } },
                tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} SV` } }
            }
        }
    });
    const covEl = document.getElementById('coveragePct');
    if (covEl) covEl.textContent = `${studentsWithFeedback} / ${totalRoster} sinh viên`;

    // ── 2. Donut: Trạng thái SV đã có Feedback ──
    const attentionPct = studentsWithFeedback > 0 ? (((yAll + rAll) / studentsWithFeedback) * 100).toFixed(1) : '0.0';
    State.charts.donut = new Chart(document.getElementById('donutChart'), {
        type: 'doughnut',
        plugins: [centerTextPlugin],
        data: {
            labels: ['🟢 Ổn định', '🟡 Theo dõi', '🔴 Cảnh báo'],
            datasets: [{
                data: [gAll, yAll, rAll],
                backgroundColor: ['#10b981', '#f59e0b', '#f43f5e'],
                borderWidth: 0, hoverOffset: 6, cutout: '68%'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                centerText: { text: attentionPct + '%', sub: 'cần lưu ý' },
                legend: { position: 'bottom', labels: { font: { family: 'Inter', size: 12 }, padding: 16, usePointStyle: true, pointStyleWidth: 10 } },
                tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} SV` } }
            }
        }
    });
    const sumEl = document.getElementById('statusSummary');
    if (sumEl) sumEl.textContent = `${gAll} Ổn định · ${yAll} Theo dõi · ${rAll} Cảnh báo`;

    // ── 3. Stacked Bar: Theo Chuyên ngành ──
    const statusMap = {};
    all.forEach(s => statusMap[s.mssv] = (s.status || 'green'));

    const majorStats = {};
    if (rosterCache && rosterCache.length > 0) {
        rosterCache.forEach(s => {
            if (!s.nganh) return;
            const sMajors = s.nganh.split(',').map(m => m.trim()).filter(Boolean);
            if (userMajors.length > 0 && !sMajors.some(m => userMajors.includes(m))) return;

            const st = statusMap[s.mssv] || 'green';
            sMajors.forEach(m => {
                if (userMajors.length > 0 && !userMajors.includes(m)) return;
                if (!majorStats[m]) majorStats[m] = { g: 0, y: 0, r: 0 };
                if (st === 'green') majorStats[m].g++;
                else if (st === 'yellow') majorStats[m].y++;
                else if (st === 'red') majorStats[m].r++;
            });
        });
    }

    const mLabels = Object.keys(majorStats).sort();
    State.charts.majorBar = new Chart(document.getElementById('majorStackedBarChart'), {
        type: 'bar',
        data: {
            labels: mLabels,
            datasets: [
                { label: 'Ổn định', data: mLabels.map(l => majorStats[l].g), backgroundColor: '#10b981', borderRadius: 2 },
                { label: 'Theo dõi', data: mLabels.map(l => majorStats[l].y), backgroundColor: '#f59e0b', borderRadius: 2 },
                { label: 'Cảnh báo', data: mLabels.map(l => majorStats[l].r), backgroundColor: '#f43f5e', borderRadius: 2 },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { labels: { font: { family: 'Inter', size: 11 }, usePointStyle: true, pointStyleWidth: 10, padding: 16 } },
                tooltip: {
                    callbacks: {
                        afterBody: (items) => {
                            const idx = items[0].dataIndex;
                            const lbl = mLabels[idx];
                            const total = majorStats[lbl].g + majorStats[lbl].y + majorStats[lbl].r;
                            return `Tổng: ${total} SV`;
                        }
                    }
                }
            },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { font: { family: 'Inter', size: 11, weight: '600' } } },
                y: { stacked: true, beginAtZero: true, ticks: { stepSize: 5, font: { family: 'Inter', size: 11 } }, grid: { color: '#f1f5f9' } }
            }
        }
    });
}


// ══════════════════════════════════════════════════════════════════
//  SECTION 10 — ADMIN MODULE (Quản lý tài khoản)
//
//  renderAdminPanel()   : render danh sách toàn bộ tài khoản trong DB.accounts.
//                         Mỗi hàng hiện: icon, tên, mã, role, lớp, trạng thái.
//                         Nút "Vô hiệu hóa / Kích hoạt" (ẩn với Admin).
//
//  toggleAccount(code)  : đảo is_active của tài khoản → re-render panel.
//
//  openCreateAccount()  : tạo tài khoản mới qua chuỗi prompt() liên tiếp.
//                         Ưu điểm prototype: không cần form, nhanh gọn.
//                         Nhược điểm: prompt() chặn main thread (chỉ OK khi demo).
// ══════════════════════════════════════════════════════════════════
async function renderAdminPanel() {
    const list = document.getElementById('accountList');
    list.innerHTML = `<div class="p-5 text-center text-slate-500 text-sm">Đang tải dữ liệu...</div>`;

    if (!supabase) return;
    const { data: accounts, error } = await supabase.from('accounts').select('*').order('created_at', { ascending: false });
    if (error) {
        list.innerHTML = `<div class="p-5 text-center text-rose-500 text-sm">Lỗi tải dữ liệu: ${error.message}</div>`;
        return;
    }

    const majorSelect = document.getElementById('adminMajorFilter');
    if (majorSelect) {
        const curMajor = majorSelect.value;
        const majors = [...new Set(accounts.flatMap(a => (a.major || '').split(',').map(m => m.trim())).filter(Boolean))].sort();
        majorSelect.innerHTML = '<option value="">Tất cả ngành</option>';
        majors.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            majorSelect.appendChild(opt);
        });
        if (curMajor) majorSelect.value = curMajor;
    }

    const roleFilter = document.getElementById('adminRoleFilter')?.value || '';
    const majorFilter = majorSelect?.value || '';

    let filtered = accounts.filter(a => {
        const aRole = (a.raw_role || '').toLowerCase();
        if (roleFilter && aRole !== roleFilter.toLowerCase()) return false;

        const aMajors = (a.major || '').split(',').map(m => m.trim().toLowerCase()).filter(Boolean);
        if (majorFilter && !aMajors.includes(majorFilter.toLowerCase())) return false;

        return true;
    });

    if (!filtered.length) {
        list.innerHTML = `<div class="p-5 text-center text-slate-500 text-sm">Không tìm thấy tài khoản nào phù hợp</div>`;
        return;
    }

    list.innerHTML = filtered.map(a => {
        const rawRole = (a.raw_role || '').toUpperCase() === 'ADMIN' ? 'Admin' : (a.raw_role || '').toUpperCase();
        const bgIcon = { Admin: 'bg-rose-100', GV: 'bg-blue-100', CTSV: 'bg-emerald-100', CNBM: 'bg-purple-100' }[rawRole] || 'bg-slate-100';
        const icon = { Admin: '🔧', GV: '👨‍🏫', CTSV: '👤', CNBM: '🎓' }[rawRole] || '👤';

        return `
        <div class="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition">
            <div class="flex items-center gap-3">
                <div class="w-9 h-9 ${bgIcon} rounded-xl flex items-center justify-center text-lg">${icon}</div>
                <div>
                    <p class="font-semibold text-sm text-slate-700">${a.name}</p>
                    <p class="text-xs text-slate-400"><span class="font-mono">${a.code}</span> · ${a.role}${a.major ? ' · ' + a.major : ''}</p>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-xs px-2 py-0.5 rounded-full font-semibold ${a.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
                    ${a.is_active ? 'Active' : 'Inactive'}
                </span>
                <!-- Nút toggle ẩn với Admin -->
                ${rawRole !== 'Admin' ? `
                <button onclick="toggleAccount('${a.code}', ${a.is_active})"
                    class="text-xs px-2.5 py-1 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 transition font-medium">
                    ${a.is_active ? 'Vô hiệu hóa' : 'Kích hoạt'}
                </button>` : ''}
            </div>
        </div>`;
    }).join('');
}

// Toggle kích hoạt / vô hiệu hóa tài khoản (Supabase)
async function toggleAccount(code, currentStatus) {
    if (!supabase) return;
    const { error } = await supabase.from('accounts').update({ is_active: !currentStatus }).eq('code', code);
    if (error) alert("Lỗi: " + error.message);
    else renderAdminPanel();
}

// Tạo tài khoản mới qua prompt liên tiếp (Supabase)
async function openCreateAccount() {
    const code = prompt('Mã truy cập mới (VD: GV_THANH):'); if (!code) return;
    const name = prompt('Tên hiển thị:'); if (!name) return;
    const role = prompt('Vai trò (Admin / GV / CTSV / CNBM):'); if (!role) return;

    let major = null;
    if (role === 'GV' || role === 'CNBM') {
        major = prompt('Ngành quản lý (VD: Computing, Business... để trống nếu không có):') || null;
    }

    const c = code.trim().toUpperCase();
    const { error } = await supabase.from('accounts').insert([{
        code: c,
        name: name.trim(),
        role: role === 'GV' ? 'Giảng viên' : role,
        raw_role: role.trim(),
        major: major,
        is_active: true
    }]);

    if (error) alert(`❌ Lỗi tạo tài khoản: ${error.message}`);
    else {
        alert(`✅ Đã tạo tài khoản: ${c}`);
        renderAdminPanel();
    }
}

// Lấy danh sách Bug Reports (chỉ Admin)
async function renderBugReports() {
    const list = document.getElementById('bugReportList');
    if (!list) return;
    list.innerHTML = `<div class="p-8 text-center text-slate-400 text-sm">Đang tải báo cáo...</div>`;

    if (!supabase) return;
    const { data: bugs, error } = await supabase
        .from('bug_reports')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        list.innerHTML = `<div class="p-5 text-center text-rose-500 text-sm">Lỗi tải báo cáo: ${error.message}</div>`;
        return;
    }

    if (!bugs || bugs.length === 0) {
        list.innerHTML = `<div class="p-8 text-center text-slate-400 text-sm">Chưa có báo cáo nào.</div>`;
        return;
    }

    let html = '';
    for (let b of bugs) {
        const timeStr = timeAgo(b.created_at);
        const statusBadge = b.status === 'resolved' 
            ? `<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] uppercase font-bold">Đã xử lý</span>`
            : `<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[10px] uppercase font-bold">Chưa xử lý</span>`;

        html += `
        <div class="px-5 py-4 flex gap-3 hover:bg-slate-50 transition border-b border-slate-50 last:border-0">
            <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-lg shrink-0">🐛</div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                    <span class="font-bold text-sm text-slate-700">${b.author_name}</span>
                    <span class="text-xs text-slate-400">· ${b.role}</span>
                    ${statusBadge}
                </div>
                <p class="text-sm text-slate-600 whitespace-pre-wrap">${b.content}</p>
                <p class="text-xs text-slate-400 mt-2">${timeStr}</p>
            </div>
            ${b.status === 'pending' ? `
            <div>
                <button onclick="resolveBug(${b.id})" class="text-xs text-indigo-600 hover:text-indigo-800 font-semibold px-2 py-1 border border-indigo-200 rounded hover:bg-indigo-50 transition">Xong</button>
            </div>
            ` : ''}
        </div>
        `;
    }
    list.innerHTML = html;
}

async function resolveBug(id) {
    if(!confirm('Đánh dấu báo cáo này là "Đã xử lý"?')) return;
    const { error } = await supabase.from('bug_reports').update({ status: 'resolved' }).eq('id', id);
    if(error) alert('Lỗi: ' + error.message);
    else renderBugReports();
}

// ══════════════════════════════════════════════════════════════════
//  SECTION 11 — TABS (Điều hướng tab)
//
//  switchTab(tab, silent):
//  – Ẩn tất cả tabContent* ngoại trừ tab đang chọn
//  – Cập nhật class active / text-color cho các nút tab
//  – Nếu !silent: gọi renderAnalytics() hoặc renderAdminPanel()
//    (lazy render: chỉ render khi user thực sự chuyển tab)
//
//  cap(s): helper viết hoa chữ cái đầu (vd: 'dashboard' → 'Dashboard')
//          dùng để tạo id như 'tabContentDashboard', 'tabDashboard'
// ══════════════════════════════════════════════════════════════════
function switchTab(tab, silent) {
    ['dashboard', 'analytics', 'admin'].forEach(t => {
        const content = document.getElementById('tabContent' + cap(t));
        if (content) content.classList.toggle('hidden', t !== tab); // ẩn tab không active
        const btn = document.getElementById('tab' + cap(t));
        if (btn) { btn.classList.toggle('active', t === tab); btn.classList.toggle('text-slate-400', t !== tab); btn.classList.toggle('text-slate-600', t === tab); }
    });
    if (!silent && tab === 'analytics') renderAnalytics(); // lazy init chart
    if (!silent && tab === 'admin') {
        renderAdminPanel();
        renderBugReports();
    }
}

// Viết hoa chữ đầu: dùng để map tab name → element id
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ══════════════════════════════════════════════════════════════════
//  SECTION 12 — NOTIFICATION MODULE (Thông báo)
//
//  toggleNotif()      : toggle dropdown, render nội dung khi mở
//  renderNotifPanel() : tạo danh sách thông báo từ DB:
//                       – SV đang cảnh báo đỏ (status='red'), mới nhất trước
//                       – Click vào item → đóng dropdown, mở hồ sơ SV
//  markAllRead()      : ẩn badge số, đóng dropdown
//  closeNotifIfOutside: đóng dropdown khi click ra ngoài
// ══════════════════════════════════════════════════════════════════
// Hàm tiện ích lấy thời gian mới nhất của 1 sinh viên (từ status update hoặc feedback mới)
function getLatestTime(s) {
    const t1 = s.updated_at ? new Date(s.updated_at).getTime() : 0;
    const t2 = s.latestFbCreatedAt ? new Date(s.latestFbCreatedAt).getTime() : 0;
    return Math.max(t1, t2);
}

// Lấy danh sách SV mục tiêu cho thông báo (có cập nhật trong vòng 24h qua)
function getTargetStudentsForNotif() {
    if (!State.students) return [];

    const now = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    let targetStudents = State.students
        .filter(s => {
            // Chỉ thông báo cho các case cần chú ý
            const isRedOrYellow = (s.status === 'red' || s.status === 'yellow');
            const hasFeedback = (s.feedbacks && s.feedbacks.length > 0);
            if (!isRedOrYellow && !hasFeedback) return false;

            // ĐÃ ĐỌC (Toàn cục): Nếu user hiện tại đã thả tim vào feedback MỚI NHẤT 
            // hoặc chính họ là người viết feedback mới nhất, thì tắt noti cho user này.
            if (s.feedbacks && s.feedbacks.length > 0 && State.user) {
                const latestFb = s.feedbacks.reduce((prev, current) => (prev.created_at > current.created_at) ? prev : current);
                const isWithin24h = (now - new Date(latestFb.created_at).getTime()) <= ONE_DAY_MS;
                const hasReacted = latestFb.reactions && latestFb.reactions.some(r => r.code === State.user.code);
                const isAuthor = latestFb.author_code === State.user.code;

                if (isWithin24h && (hasReacted || isAuthor)) {
                    return false;
                }
            }

            // Check xem thời gian cập nhật có nằm trong 24h qua không
            const latestTime = getLatestTime(s);
            return (now - latestTime) <= ONE_DAY_MS;
        });

    if (State.user && State.user.rawRole === 'GV') {
        const ucode = State.user.code.toLowerCase();
        const uname = State.user.name.toLowerCase();
        targetStudents = targetStudents.filter(s => {
            if (!s.giang_vien) return false;
            const gvStr = s.giang_vien.toLowerCase();
            return gvStr.includes(ucode) || gvStr.includes(uname);
        });
    } else if (State.user && State.user.rawRole === 'CTSV') {
        targetStudents = targetStudents.filter(s => {
            const fbs = s.feedbacks || [];
            
            // ĐÃ ĐỌC: Nếu thao tác mới nhất trên sinh viên này là của CTSV và trong vòng 24h, thì xem như CTSV đã xử lý/đọc
            if (fbs.length > 0) {
                const latestFb = fbs.reduce((prev, current) => (prev.created_at > current.created_at) ? prev : current);
                const isWithin24h = (Date.now() - new Date(latestFb.created_at).getTime()) <= (24 * 60 * 60 * 1000);
                if (latestFb.role === 'CTSV' && isWithin24h) {
                    return false;
                }
            }
            
            // Loại 1: Cần CTSV hỗ trợ (dựa trên feedback mới nhất)
            let needsSupport = false;
            if (fbs.length > 0) {
                const latestFb = fbs.reduce((prev, current) => (prev.created_at > current.created_at) ? prev : current);
                if (latestFb.content && latestFb.content.includes('[CẦN CTSV HỖ TRỢ]')) {
                    needsSupport = true;
                }
            }
            
            // Loại 2: Cập nhật của các trạng thái đỏ (vì base filter đã lọc <= 24h)
            const isRedUpdate = (s.status === 'red');

            // Loại 3: Các reply của GV/CNBM phản hồi lại comment của CTSV trong vòng 24h
            let hasGvReplyToCtsv = false;
            const ONE_DAY = 24 * 60 * 60 * 1000;
            const currentTime = Date.now();
            for (const f of fbs) {
                if (['GV', 'CNBM'].includes(f.role) && f.parent_id) {
                    if (currentTime - new Date(f.created_at).getTime() <= ONE_DAY) {
                        const parent = fbs.find(p => p.id === f.parent_id);
                        if (parent && parent.role === 'CTSV') {
                            hasGvReplyToCtsv = true;
                            break;
                        }
                    }
                }
            }
            
            return needsSupport || isRedUpdate || hasGvReplyToCtsv;
        });
    }
    return targetStudents.sort((a, b) => getLatestTime(b) - getLatestTime(a));
}

function updateNotifBadge() {
    const targetStudents = getTargetStudentsForNotif();
    const badge = document.getElementById('notifBadge');

    if (targetStudents.length > 0) {
        badge.textContent = targetStudents.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function toggleNotif() {
    const dd = document.getElementById('notifDropdown');
    const isOpen = dd.classList.contains('active');
    if (!isOpen) renderNotifPanel();
    dd.classList.toggle('active');
}

function renderNotifPanel() {
    const container = document.getElementById('notifList');
    const targetStudents = getTargetStudentsForNotif();

    if (!targetStudents.length) {
        container.innerHTML = `
        <div class="px-4 py-8 text-center">
            <div class="text-3xl mb-2">✅</div>
            <p class="text-sm text-slate-500">Không có cập nhật nào trong 24h qua</p>
        </div>`;
        return;
    }

    container.innerHTML = targetStudents.map(s => {
        const latestTime = getLatestTime(s);

        const text = s.latestFbContent;
        const preview = text
            ? (text.length > 55 ? text.slice(0, 55) + '…' : text)
            : 'Chưa có phản hồi';

        let icon = '🔴', textClass = 'text-rose-500';
        if (s.status === 'yellow') {
            icon = '🟡'; textClass = 'text-amber-500';
        } else if (s.status === 'green') {
            icon = '🟢'; textClass = 'text-emerald-500';
        }

        return `
        <div onclick="notifGoTo(${s.id})" class="flex items-start gap-3 px-4 py-3 bg-white hover:bg-slate-50 cursor-pointer transition border-b border-slate-100 last:border-0">
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5 bg-white border border-slate-200 shadow-sm">${icon}</div>
            <div class="min-w-0 pr-4">
                <p class="text-sm font-semibold text-slate-800">${s.ho_ten}</p>
                <p class="text-xs text-slate-500 font-mono">${s.mssv} · ${s.lop || 'N/A'}</p>
                <p class="text-xs text-slate-500 mt-0.5 truncate">💬 ${preview}</p>
                <p class="text-xs ${textClass} mt-1 font-medium">⏱️ ${timeAgo(latestTime)}</p>
            </div>
        </div>`;
    }).join('');
}

// Click vào 1 thông báo → đóng dropdown + mở hồ sơ SV
function notifGoTo(studentId) {
    document.getElementById('notifDropdown').classList.remove('active');
    openStudentModal(studentId);
}

// Đóng dropdown khi click ra ngoài vùng chuông
document.addEventListener('click', function (e) {
    const wrapper = document.getElementById('notifBtn')?.closest('.relative');
    if (wrapper && !wrapper.contains(e.target))
        document.getElementById('notifDropdown')?.classList.remove('active');
});

// ══════════════════════════════════════════════════════════════════
//  SECTION 13 — UI HELPERS (Tiện ích giao diện)
//
//  timeAgo(dateString): chuyển timestamp ISO thành chuỗi "X phút trước",
//  "X giờ trước", "X ngày trước" hoặc "Vừa xong" (nếu < 60 giây).
//  Dùng ở nhiều nơi: thẻ SV trong danh sách, bubble feedback trong timeline.
// ══════════════════════════════════════════════════════════════════
function timeAgo(ds) {
    if (!ds) return 'N/A';
    const d = Math.floor((Date.now() - new Date(ds)) / 1000); // delta giây
    if (d < 60) return 'Vừa xong';
    if (d < 3600) return `${Math.floor(d / 60)} phút trước`;
    if (d < 86400) return `${Math.floor(d / 3600)} giờ trước`;
    return `${Math.floor(d / 86400)} ngày trước`;
}

console.log('✅ SRMH v2.1 Ready!');

// ══════════════════════════════════════════════════════════════════
//  SECTION 14 — REPORT MODULE (Xuất báo cáo phản hồi sinh viên)
//
//  Phân quyền:
//  – Admin, CNBM : tất cả feedback → lọc tuỳ chọn theo lớp
//  – CTSV        : chỉ feedback mình tạo → lọc theo lớp
//  – GV          : chỉ feedback mình tạo → lọc theo lớp
//
//  Mỗi hàng = 1 SV, hiện feedback GẦN NHẤT do user hiện tại có quyền xem.
//  Click vào tiêu đề cột → toggle bôi xanh cột đó (dễ select + copy).
//
//  openReportModal()  : mở modal, populate dropdown lớp theo role
//  closeReportModal() : đóng modal, reset state bảng
//  generateReport()   : lọc dữ liệu → render bảng HTML
//  highlightCol(i)    : toggle class .col-highlight cho cột thứ i
// ══════════════════════════════════════════════════════════════════

// Track cột đang được highlight (-1 = không có)
let _reportHighlightCol = -1;

function openReportModal() {
    const role = State.user.rawRole;

    // Subtitle mô tả quyền của user hiện tại
    const subtitleMap = {
        Admin: 'Quyền xem: Tất cả feedback · Lọc theo lớp tuỳ chọn',
        CNBM: `Quyền xem: Tất cả feedback — Bộ môn ${State.user.major || 'N/A'} · Lọc theo lớp`,
        CTSV: 'Quyền xem: Feedback do bạn tạo · Lọc theo lớp',
        GV: `Quyền xem: Feedback do bạn tạo · Chỉ lớp ${State.user.lop || 'được phân công'}`,

    };
    document.getElementById('reportSubtitle').textContent = subtitleMap[role] || '';

    // Populate dropdown lớp tuỳ theo role:
    // – GV   : chỉ hiện lớp của chính GV (State.user.lop), tự động chọn sẵn
    // – Khác : hiện toàn bộ lớp từ DB.students
    const sel = document.getElementById('reportClassFilter');
    sel.innerHTML = '<option value="all">Tất cả lớp</option>';
    if (role === 'GV' && State.user.lop) {
        // GV chỉ được xem lớp mình phụ trách
        const o = document.createElement('option');
        o.value = State.user.lop; o.textContent = State.user.lop;
        sel.appendChild(o);
        sel.value = State.user.lop; // tự động chọn lớp của GV
    } else {
        const classSet = new Set();
        State.students.forEach(s => (s.lop || '').split(',')
            .map(c => c.trim().replace(/[{}\[\]()]/g, '').trim()).filter(Boolean)
            .forEach(c => classSet.add(c)));
        [...classSet].sort().forEach(c => {
            const o = document.createElement('option');
            o.value = c; o.textContent = c;
            sel.appendChild(o);
        });
    }

    // Reset bảng về trạng thái placeholder
    _reportHighlightCol = -1;
    document.getElementById('reportPlaceholder').classList.remove('hidden');
    document.getElementById('reportTableContainer').classList.add('hidden');
    document.getElementById('reportEmpty').classList.add('hidden');
    document.getElementById('reportSummary').textContent = '';

    document.getElementById('reportModal').classList.add('active');
}

function closeReportModal() {
    document.getElementById('reportModal').classList.remove('active');
    // Reset nút copy toàn bộ về ẩn
    const btn = document.getElementById('reportCopyAllBtn');
    if (btn) btn.className = btn.className.replace('flex', 'hidden');
}

async function generateReport() {
    const btn = document.querySelector('button[onclick="generateReport()"]');
    const oldText = btn.innerHTML;
    btn.innerHTML = '⏳ Đang tạo...';
    btn.disabled = true;

    const role = State.user.rawRole;
    const classF = document.getElementById('reportClassFilter').value;

    // Bước 1: Lọc feedback theo phân quyền từ Supabase
    // – Admin, CNBM: tất cả feedback
    // – CTSV, GV   : chỉ feedback do bản thân tạo
    let query = supabase.from('feedbacks').select('*').is('parent_id', null);
    if (['CTSV', 'GV'].includes(role)) {
        query = query.eq('author_code', State.user.code);
    }

    const { data: validFeedbacks, error } = await query.order('created_at', { ascending: false });
    if (error) {
        alert("Lỗi tải báo cáo: " + error.message);
        btn.innerHTML = oldText; btn.disabled = false;
        return;
    }

    // Bước 2: Với mỗi SV, lấy feedback GẦN NHẤT trong tập hợp hợp lệ
    // Kết quả: mảng { student, feedback } — bỏ qua SV không có feedback hợp lệ
    let rows = State.students
        .map(s => {
            const fbs = validFeedbacks.filter(f => f.student_id === s.id);
            return fbs.length ? { student: s, feedback: fbs[0] } : null;
        })
        .filter(Boolean);

    // Bước 3a: Với GV — bắt buộc lọc chỉ hiển thị SV do mình dạy (có tên trong roster)
    if (role === 'GV') {
        const ucode = State.user.code.toLowerCase();
        const uname = State.user.name.toLowerCase();
        rows = rows.filter(r => {
            if (!r.student.giang_vien) return false;
            const gvStr = r.student.giang_vien.toLowerCase();
            return gvStr.includes(ucode) || gvStr.includes(uname);
        });
    }

    // Bước 3b: Lọc thêm theo classF nếu không chọn "Tất cả" (áp dụng cho Admin/CNBM/CTSV)
    if (classF !== 'all' && role !== 'GV') {
        rows = rows.filter(r =>
            (r.student.lop || '').split(',').map(c => c.trim().replace(/[{}\[\]()]/g, '').trim()).includes(classF)
        );
    }

    btn.innerHTML = oldText; btn.disabled = false;
    // Ẩn placeholder
    document.getElementById('reportPlaceholder').classList.add('hidden');

    if (!rows.length) {
        document.getElementById('reportTableContainer').classList.add('hidden');
        document.getElementById('reportEmpty').classList.remove('hidden');
        document.getElementById('reportSummary').textContent = 'Không có dữ liệu';
        // Ẩn nút copy toàn bộ khi không có dữ liệu
        const copyAllBtn = document.getElementById('reportCopyAllBtn');
        if (copyAllBtn) { copyAllBtn.classList.add('hidden'); copyAllBtn.classList.remove('flex'); }
        return;
    }

    document.getElementById('reportEmpty').classList.add('hidden');
    document.getElementById('reportTableContainer').classList.remove('hidden');
    // Hiện nút "Copy toàn bộ" khi bảng có dữ liệu
    const copyAllBtn = document.getElementById('reportCopyAllBtn');
    if (copyAllBtn) { copyAllBtn.classList.remove('hidden'); copyAllBtn.classList.add('flex'); }

    // Bước 4: Render header bảng
    // Mỗi <th> gắn onclick highlightCol(i) để bôi xanh cả cột
    const cols = ['MSSV', 'Họ và tên sinh viên', 'Lớp / Mã môn', 'Giảng viên phụ trách', 'Người ghi nhận', 'Phản hồi gần nhất', 'Thời gian'];
    document.getElementById('reportThead').innerHTML = `
        <tr>
            ${cols.map((c, i) => `
                <th onclick="highlightCol(${i})" title="Click để bôi xanh cột — dễ copy">
                    ${c} <span style="font-size:9px;opacity:.7">▼</span>
                </th>
            `).join('')}
        </tr>`;

    // Bước 5: Render body bảng
    // Sort: SV cảnh báo đỏ lên trước, rồi theo thời gian feedback mới nhất
    rows.sort((a, b) => {
        const o = { red: 0, yellow: 1, green: 2 };
        const d = (o[a.student.status || 'green']) - (o[b.student.status || 'green']);
        return d !== 0 ? d : new Date(b.feedback.created_at) - new Date(a.feedback.created_at);
    });

    const statusEmoji = { green: '🟢', yellow: '🟡', red: '🔴' };

    document.getElementById('reportTbody').innerHTML = rows.map(({ student: s, feedback: f }) => {
        const lopDisplay = `${s.lop || 'N/A'}${s.ma_mon ? ` (📚 ${s.ma_mon})` : ''}`;
        const fbTime = new Date(f.created_at).toLocaleString('vi-VN',
            { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const authorLabel = f.author_name ? `${f.author_name} (${f.role})` : 'Ẩn danh';
        const statusMark = statusEmoji[s.status || 'green'];

        return `<tr>
            <td class="font-mono text-xs text-slate-500 whitespace-nowrap">${s.mssv}</td>
            <td class="font-semibold text-slate-800 whitespace-nowrap">${s.ho_ten}</td>
            <td class="text-xs text-slate-600 whitespace-nowrap">${lopDisplay}</td>
            <td class="text-xs text-slate-600 whitespace-nowrap">${s.giang_vien || 'N/A'}</td>
            <td class="text-xs text-slate-600 whitespace-nowrap">${authorLabel}</td>
            <td class="text-sm text-slate-700" style="min-width:260px;max-width:400px">${f.content}</td>
            <td class="text-xs text-slate-400 whitespace-nowrap">${fbTime}</td>
        </tr>`;
    }).join('');

    // Reset highlight cột
    _reportHighlightCol = -1;
    _applyColHighlight();

    document.getElementById('reportSummary').textContent =
        `📋 ${rows.length} sinh viên · Bộ lọc: ${classF === 'all' ? 'Tất cả lớp' : classF} · Hiển thị feedback gần nhất`;
}

// Toggle bôi xanh cột thứ colIndex (click lần 2 vào cùng cột → bỏ highlight)
function highlightCol(colIndex) {
    _reportHighlightCol = (_reportHighlightCol === colIndex) ? -1 : colIndex;
    _applyColHighlight();

    // Hiện/ẩn nút Copy và hint
    const hasCol = _reportHighlightCol !== -1;
    const copyBtn = document.getElementById('reportCopyBtn');
    const copyHint = document.getElementById('reportCopyHint');
    if (copyBtn) { copyBtn.classList.toggle('hidden', !hasCol); copyBtn.classList.toggle('flex', hasCol); }
    if (copyHint) { copyHint.classList.toggle('hidden', hasCol); }
}

// Thực sự thêm/xóa class highlight cho tất cả ô trong cột đó
function _applyColHighlight() {
    const table = document.querySelector('#reportTableContainer .report-table');
    if (!table) return;
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
        row.querySelectorAll('th, td').forEach((cell, i) => {
            const isHeader = cell.tagName === 'TH';
            if (_reportHighlightCol === -1) {
                cell.classList.remove(isHeader ? 'col-highlight-hd' : 'col-highlight');
            } else if (i === _reportHighlightCol) {
                cell.classList.add(isHeader ? 'col-highlight-hd' : 'col-highlight');
            } else {
                cell.classList.remove(isHeader ? 'col-highlight-hd' : 'col-highlight');
            }
        });
    });
}

// Copy nội dung cột đang highlight vào clipboard
// – Lấy text từng ô td trong cột đó (bỏ qua thẻ th đ — header)
// – Nối bằng newline → có thể paste trực tiếp vào Excel / Google Sheets
function copyHighlightedCol() {
    if (_reportHighlightCol === -1) return;
    const table = document.querySelector('#reportTableContainer .report-table');
    if (!table) return;

    // Lẵy tất cả các ô td (không lấy th) trong cột được chọn
    const cells = table.querySelectorAll(`tbody tr td:nth-child(${_reportHighlightCol + 1})`);
    const text = [...cells].map(c => c.innerText.trim()).join('\n');

    if (!text) { showCopyToast('⚠️ Cột trống, không có gì để copy'); return; }

    navigator.clipboard.writeText(text)
        .then(() => showCopyToast(`✅ Đã copy ${cells.length} ô vào clipboard!`))
        .catch(() => {
            // Fallback cho trình duyệt không hỗ trợ Clipboard API
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showCopyToast(`✅ Đã copy ${cells.length} ô!`);
        });
}

// Hiện toast thông báo nhỏ 2 giây sau đó tự ẩn
function showCopyToast(msg) {
    let toast = document.getElementById('copyToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'copyToast';
        toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(8px);' +
            'background:#1e293b;color:white;padding:8px 18px;border-radius:12px;font-size:13px;font-weight:600;' +
            'z-index:9999;opacity:0;transition:all .2s;pointer-events:none;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.25)';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    // Animate in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    // Animate out sau 2 giây
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(8px)';
    }, 2000);
}

// Copy toàn bộ bảng dưới dạng TSV (Tab-Separated Values)
// – Dòng 1: tiêu đề cột (từ thẻ <th>)
// – Các dòng tiếp theo: nội dung từng hàng, các ô ngăn cách bằng TAB
// – Paste vào Excel / Google Sheets sẽ ra đúng từng cột
function copyFullTable() {
    const table = document.querySelector('#reportTableContainer .report-table');
    if (!table) return;

    const lines = [];

    // Hàng header
    const headers = [...table.querySelectorAll('thead th')].map(th => th.innerText.replace('▼', '').trim());
    lines.push(headers.join('\t'));

    // Các hàng dữ liệu
    table.querySelectorAll('tbody tr').forEach(row => {
        const cells = [...row.querySelectorAll('td')].map(td => td.innerText.trim().replace(/\n/g, ' '));
        lines.push(cells.join('\t'));
    });

    const tsv = lines.join('\n');
    const rowCount = lines.length - 1; // trừ header

    navigator.clipboard.writeText(tsv)
        .then(() => showCopyToast(`✅ Đã copy toàn bộ bảng (${rowCount} dòng, ${headers.length} cột)!`))
        .catch(() => {
            const ta = document.createElement('textarea');
            ta.value = tsv; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showCopyToast(`✅ Đã copy toàn bộ bảng (${rowCount} dòng)!`);
        });
}

// ══════════════════════════════════════════════════════════════════
//  SECTION 16 — BUG REPORTS & FEEDBACK CỦA USER
// ══════════════════════════════════════════════════════════════════
function openBugModal() {
    const m = document.getElementById('bugReportModal');
    if (!m) return;
    m.classList.remove('hidden');
    m.classList.add('flex');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        m.firstElementChild.classList.remove('scale-95');
    }, 10);
}

function closeBugModal() {
    const m = document.getElementById('bugReportModal');
    if (!m) return;
    m.classList.add('opacity-0');
    m.firstElementChild.classList.add('scale-95');
    setTimeout(() => {
        m.classList.add('hidden');
        m.classList.remove('flex');
        document.getElementById('bugContent').value = '';
    }, 200);
}

async function submitBugReport() {
    const content = document.getElementById('bugContent').value.trim();
    if (!content) {
        alert('Vui lòng nhập nội dung báo lỗi hoặc góp ý!');
        return;
    }

    const btn = document.getElementById('btnSubmitBug');
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
    }

    if (supabase) {
        const { error } = await supabase.from('bug_reports').insert([{
            author_code: State.user.code,
            author_name: State.user.name,
            role: State.user.role,
            content: content
        }]);

        if (error) {
            console.error('Lỗi khi gửi báo cáo:', error);
            alert('Lỗi khi gửi báo cáo: ' + error.message);
        } else {
            alert('Cảm ơn bạn đã gửi báo cáo/góp ý!');
            closeBugModal();
        }
    }

    if (btn) {
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

// ══════════════════════════════════════════════════════════════════
// EXCEL IMPORT - STUDENT ROSTER
// ══════════════════════════════════════════════════════════════════

function closeExcelProgressModal() {
    const m = document.getElementById('excelProgressModal');
    if (!m) return;
    m.classList.add('opacity-0');
    m.firstElementChild.classList.add('scale-95');
    setTimeout(() => {
        m.classList.add('hidden');
        m.classList.remove('flex');
    }, 200);
}

async function handleExcelUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Reset input để lần sau chọn lại file cùng tên vẫn trigger change
    event.target.value = '';

    // Mở modal progress
    const modal = document.getElementById('excelProgressModal');
    const pText = document.getElementById('excelProgressText');
    const pBar = document.getElementById('excelProgressBar');
    const pPercent = document.getElementById('excelProgressPercent');
    const pBtn = document.getElementById('excelProgressCloseBtn');
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.firstElementChild.classList.remove('scale-95');
    }, 10);

    pText.textContent = "Đang đọc file Excel...";
    pBar.style.width = "5%";
    pPercent.textContent = "5%";
    pBtn.classList.add('hidden');
    pBar.classList.remove('bg-rose-500', 'bg-indigo-500');
    pBar.classList.add('bg-emerald-500');
    pPercent.classList.remove('text-rose-600', 'text-indigo-600');
    pPercent.classList.add('text-emerald-600');

    try {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                // Lấy sheet đầu tiên
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                
                // Chuyển thành mảng các mảng (header: 1)
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
                
                if (rows.length < 2) {
                    throw new Error("File Excel không có dữ liệu hoặc không đúng định dạng.");
                }

                pText.textContent = "Đang xử lý và gom nhóm sinh viên...";
                pBar.style.width = "20%";
                pPercent.textContent = "20%";

                const studentsMap = {};

                // Bỏ qua dòng đầu tiên (tiêu đề), lặp từ dòng 1
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    // Cấu trúc cột giả định: STT, MSSV, Tên, Lớp, Môn, Ngành, Giảng viên
                    let roll = row[1];
                    if (!roll) continue;
                    roll = String(roll).trim();

                    const name = String(row[2] || '').trim();
                    const group = String(row[3] || '').trim();
                    const subject = String(row[4] || '').trim();
                    const nganh = String(row[5] || '').trim();
                    const teacher = String(row[6] || '').trim();

                    if (!studentsMap[roll]) {
                        studentsMap[roll] = {
                            mssv: roll,
                            ho_ten: name,
                            lop_set: new Set(),
                            ma_mon_set: new Set(),
                            giang_vien_set: new Set(),
                            nganh_set: new Set()
                        };
                    }

                    if (group) studentsMap[roll].lop_set.add(group);
                    if (subject) studentsMap[roll].ma_mon_set.add(subject);
                    if (teacher) studentsMap[roll].giang_vien_set.add(teacher);
                    if (nganh) studentsMap[roll].nganh_set.add(nganh);
                }

                // Chuyển Set thành chuỗi phân cách bởi dấu phẩy
                const finalRows = Object.values(studentsMap).map(st => {
                    const sortedLop = Array.from(st.lop_set).sort().join(', ');
                    const sortedMon = Array.from(st.ma_mon_set).sort().join(', ');
                    const sortedGV = Array.from(st.giang_vien_set).sort().join(', ');
                    const sortedNganh = Array.from(st.nganh_set).sort().join(', ');

                    return {
                        mssv: st.mssv,
                        ho_ten: st.ho_ten,
                        lop: sortedLop || null,
                        ma_mon: sortedMon || null,
                        giang_vien: sortedGV || null,
                        nganh: sortedNganh || null
                    };
                });

                if (finalRows.length === 0) {
                    throw new Error("Không tìm thấy sinh viên hợp lệ nào trong file.");
                }

                pText.textContent = `Chuẩn bị tải lên ${finalRows.length} sinh viên...`;
                pBar.style.width = "30%";
                pPercent.textContent = "30%";

                // Batch upload (mỗi batch 50 records)
                const BATCH_SIZE = 50;
                let successCount = 0;
                const totalBatches = Math.ceil(finalRows.length / BATCH_SIZE);

                for (let i = 0; i < finalRows.length; i += BATCH_SIZE) {
                    const batch = finalRows.slice(i, i + BATCH_SIZE);
                    
                    const { error } = await supabase
                        .from('student_roster')
                        .upsert(batch, { onConflict: 'mssv' });

                    if (error) {
                        console.error('Lỗi khi tải dữ liệu lên Supabase:', error);
                        throw new Error(`Lỗi tải lên dữ liệu: ${error.message}`);
                    }

                    successCount += batch.length;
                    
                    // Cập nhật progress bar
                    const percent = 30 + Math.floor((successCount / finalRows.length) * 70);
                    pBar.style.width = `${percent}%`;
                    pPercent.textContent = `${percent}%`;
                    pText.textContent = `Đã lưu ${successCount} / ${finalRows.length} sinh viên...`;
                }

                pText.textContent = `🎉 Đã nhập thành công ${successCount} sinh viên!`;
                pBar.classList.replace('bg-emerald-500', 'bg-indigo-500');
                pPercent.classList.replace('text-emerald-600', 'text-indigo-600');
                pBtn.classList.remove('hidden');

                // Tải lại roster cache trong background để cập nhật danh sách
                rosterLoaded = false;
                await loadRoster();

            } catch (err) {
                console.error(err);
                pText.textContent = `❌ Lỗi: ${err.message}`;
                pBar.classList.replace('bg-emerald-500', 'bg-rose-500');
                pPercent.classList.replace('text-emerald-600', 'text-rose-600');
                pBtn.classList.remove('hidden');
            }
        };
        
        reader.onerror = (err) => {
            console.error(err);
            pText.textContent = "❌ Lỗi không thể đọc file Excel.";
            pBar.classList.replace('bg-emerald-500', 'bg-rose-500');
            pPercent.classList.replace('text-emerald-600', 'text-rose-600');
            pBtn.classList.remove('hidden');
        };

        reader.readAsArrayBuffer(file);
    } catch (err) {
        console.error(err);
        pText.textContent = `❌ Lỗi hệ thống: ${err.message}`;
        pBar.classList.replace('bg-emerald-500', 'bg-rose-500');
        pPercent.classList.replace('text-emerald-600', 'text-rose-600');
        pBtn.classList.remove('hidden');
    }
}
