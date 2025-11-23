Ext.define('PVE.dc.TokenView', {
    extend: 'Ext.grid.GridPanel',
    alias: ['widget.pveTokenView'],

    onlineHelp: 'chapter_user_management',

    stateful: true,
    stateId: 'grid-tokens',

    initComponent: function () {
        let me = this;

        let caps = Ext.state.Manager.get('GuiCap');

        let store = new Ext.data.Store({
            id: 'tokens',
            model: 'pve-tokens',
            sorters: 'id',
        });

        let reload = function () {
            Proxmox.Utils.API2Request({
                url: '/access/users/?full=1',
                method: 'GET',
                failure: function (response, opts) {
                    Proxmox.Utils.setErrorMask(me, response.htmlStatus);
                    me.load_task.delay(me.load_delay);
                },
                success: function (response, opts) {
                    Proxmox.Utils.setErrorMask(me, false);
                    let result = Ext.decode(response.responseText);
                    let data = result.data || [];
                    let records = [];
                    Ext.Array.each(data, function (user) {
                        let tokens = user.tokens || [];
                        Ext.Array.each(tokens, function (token) {
                            let r = {};
                            r.id = user.userid + '!' + token.tokenid;
                            r.userid = user.userid;
                            r.tokenid = token.tokenid;
                            r.comment = token.comment;
                            r.expire = token.expire;
                            r.privsep = token.privsep === 1;
                            records.push(r);
                        });
                    });
                    store.loadData(records);
                },
            });
        };

        let sm = Ext.create('Ext.selection.RowModel', {});

        let urlFromRecord = (rec) => {
            let uid = encodeURIComponent(rec.data.userid);
            let tid = encodeURIComponent(rec.data.tokenid);
            return `/access/users/${uid}/token/${tid}`;
        };

        let hasTokenCRUDPermissions = function (userid) {
            return userid === Proxmox.UserName || !!caps.access['User.Modify'];
        };

        let run_editor = function (rec) {
            if (!hasTokenCRUDPermissions(rec.data.userid)) {
                return;
            }

            let win = Ext.create('PVE.dc.TokenEdit', {
                method: 'PUT',
                url: urlFromRecord(rec),
            });
            win.setValues(rec.data);
            win.on('destroy', reload);
            win.show();
        };

        let tbar = [
            {
                text: gettext('Add'),
                handler: function (btn, e) {
                    let data = {};
                    let win = Ext.create('PVE.dc.TokenEdit', {
                        isCreate: true,
                    });
                    win.setValues(data);
                    win.on('destroy', reload);
                    win.show();
                },
            },
            {
                xtype: 'proxmoxButton',
                text: gettext('Edit'),
                disabled: true,
                enableFn: (rec) => hasTokenCRUDPermissions(rec.data.userid),
                selModel: sm,
                handler: (btn, e, rec) => run_editor(rec),
            },
            {
                xtype: 'proxmoxStdRemoveButton',
                selModel: sm,
                enableFn: (rec) => hasTokenCRUDPermissions(rec.data.userid),
                callback: reload,
                getUrl: urlFromRecord,
            },
            '-',
            {
                xtype: 'proxmoxButton',
                text: gettext('Show Permissions'),
                disabled: true,
                selModel: sm,
                handler: function (btn, event, rec) {
                    Ext.create('PVE.dc.PermissionView', {
                        autoShow: true,
                        userid: rec.data.id,
                    });
                },
            },
        ];

        Ext.apply(me, {
            store: store,
            selModel: sm,
            tbar: tbar,
            viewConfig: {
                trackOver: false,
            },
            columns: [
                {
                    header: gettext('User name'),
                    dataIndex: 'userid',
                    renderer: (uid) => {
                        let realmIndex = uid.lastIndexOf('@');
                        let user = Ext.String.htmlEncode(uid.substr(0, realmIndex));
                        let realm = Ext.String.htmlEncode(uid.substr(realmIndex));
                        return `${user} <span style='float:right;'>${realm}</span>`;
                    },
                    flex: 2,
                },
                {
                    header: gettext('Token Name'),
                    dataIndex: 'tokenid',
                    hideable: false,
                    flex: 1,
                },
                {
                    header: gettext('Expire'),
                    dataIndex: 'expire',
                    hideable: false,
                    renderer: Proxmox.Utils.format_expire,
                    flex: 1,
                },
                {
                    header: gettext('Comment'),
                    dataIndex: 'comment',
                    renderer: Ext.String.htmlEncode,
                    flex: 3,
                },
                {
                    header: gettext('Privilege Separation'),
                    dataIndex: 'privsep',
                    hideable: false,
                    renderer: Proxmox.Utils.format_boolean,
                    flex: 1,
                },
            ],
            listeners: {
                activate: reload,
                itemdblclick: (view, rec) => run_editor(rec),
            },
        });

        me.callParent();
    },
});
