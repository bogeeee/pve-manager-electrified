Ext.define('PVE.form.SecurityGroupsSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: ['widget.pveSecurityGroupsSelector'],

    valueField: 'group',
    displayField: 'group',
    initComponent: function () {
        var me = this;

        var store = Ext.create('Ext.data.Store', {
            autoLoad: true,
            fields: ['group', 'comment'],
            idProperty: 'group',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/firewall/groups',
            },
            sorters: {
                property: 'group',
                direction: 'ASC',
            },
        });

        Ext.apply(me, {
            store: store,
            listConfig: {
                columns: [
                    {
                        header: gettext('Security Group'),
                        dataIndex: 'group',
                        hideable: false,
                        width: 100,
                    },
                    {
                        header: gettext('Comment'),
                        dataIndex: 'comment',
                        renderer: function (value, metaData) {
                            let comment = Ext.String.htmlEncode(value) || '';
                            if (comment.length * 12 > metaData.column.cellWidth) {
                                let qtip = Ext.htmlEncode(comment);
                                comment = `<span data-qtip="${qtip}">${comment}</span>`;
                            }
                            return comment;
                        },
                        flex: 1,
                    },
                ],
            },
        });

        me.callParent();
    },
});
