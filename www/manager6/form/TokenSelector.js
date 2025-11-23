Ext.define(
    'PVE.form.TokenSelector',
    {
        extend: 'Proxmox.form.ComboGrid',
        alias: ['widget.pveTokenSelector'],

        allowBlank: false,
        autoSelect: false,
        displayField: 'id',

        editable: true,
        anyMatch: true,
        forceSelection: true,

        store: {
            model: 'pve-tokens',
            autoLoad: true,
            proxy: {
                type: 'proxmox',
                url: 'api2/json/access/users',
                extraParams: { full: 1 },
            },
            sorters: 'id',
            listeners: {
                load: function (store, records, success) {
                    let tokens = [];
                    for (const { data: user } of records) {
                        if (!user.tokens || user.tokens.length === 0) {
                            continue;
                        }
                        for (const token of user.tokens) {
                            tokens.push({
                                id: `${user.userid}!${token.tokenid}`,
                                comment: token.comment,
                            });
                        }
                    }
                    store.loadData(tokens);
                },
            },
        },

        listConfig: {
            columns: [
                {
                    header: gettext('API Token'),
                    sortable: true,
                    dataIndex: 'id',
                    renderer: Ext.String.htmlEncode,
                    flex: 1,
                },
                {
                    header: gettext('Comment'),
                    sortable: false,
                    dataIndex: 'comment',
                    renderer: Ext.String.htmlEncode,
                    flex: 1,
                },
            ],
        },
    },
    function () {
        Ext.define('pve-tokens', {
            extend: 'Ext.data.Model',
            fields: [
                'id',
                'userid',
                'tokenid',
                'comment',
                { type: 'boolean', name: 'privsep' },
                { type: 'date', dateFormat: 'timestamp', name: 'expire' },
            ],
            idProperty: 'id',
        });
    },
);
