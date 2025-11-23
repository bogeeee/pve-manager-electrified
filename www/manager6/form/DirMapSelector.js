Ext.define('PVE.form.DirMapSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: 'widget.pveDirMapSelector',

    store: {
        fields: ['name', 'path'],
        filterOnLoad: true,
        sorters: [
            {
                property: 'id',
                direction: 'ASC',
            },
        ],
    },

    allowBlank: false,
    autoSelect: false,
    displayField: 'id',
    valueField: 'id',

    listConfig: {
        columns: [
            {
                header: gettext('Directory ID'),
                dataIndex: 'id',
                flex: 1,
            },
            {
                header: gettext('Comment'),
                dataIndex: 'description',
                flex: 1,
            },
        ],
    },

    setNodename: function (nodename) {
        var me = this;

        if (!nodename || me.nodename === nodename) {
            return;
        }

        me.nodename = nodename;

        me.store.setProxy({
            type: 'proxmox',
            url: `/api2/json/cluster/mapping/dir?check-node=${nodename}`,
        });

        me.store.load();
    },

    initComponent: function () {
        var me = this;

        var nodename = me.nodename;
        me.nodename = undefined;

        me.callParent();

        me.setNodename(nodename);
    },
});
