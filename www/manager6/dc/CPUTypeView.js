Ext.define('pve-custom-cpu-type', {
    extend: 'Ext.data.Model',
    fields: [
        'cputype',
        'reported-model',
        'hv-vendor-id',
        'flags',
        'phys-bits',
        { name: 'hidden', type: 'boolean' },
    ],
});

Ext.define('PVE.dc.CPUTypeView', {
    extend: 'Ext.grid.GridPanel',
    alias: ['widget.pveCPUTypeView'],

    onlineHelp: '_cpu_type',

    store: {
        model: 'pve-custom-cpu-type',
        proxy: {
            type: 'proxmox',
            url: '/api2/json/cluster/qemu/custom-cpu-models',
        },
        autoLoad: true,
        sorters: ['cputype'],
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        getSelection: function () {
            let me = this;
            let grid = me.getView();
            let selection = grid.getSelection();
            if (selection.length === 1) {
                return selection[0].data;
            }
            return null;
        },

        showEditor: function (cputype) {
            let me = this;
            let param = cputype ? { cputype } : {};
            let win = Ext.create('PVE.dc.CPUTypeEdit', param);
            win.on('destroy', () => me.reload());
            win.show();
        },

        onAdd: function () {
            let me = this;
            me.showEditor();
        },

        onEdit: function () {
            let me = this;
            let selection = me.getSelection();
            me.showEditor(selection.cputype);
        },

        reload: function () {
            let me = this;
            me.getView().getStore().reload();
        },
    },

    columns: [
        {
            header: gettext('Name'),
            flex: 1,
            dataIndex: 'cputype',
            renderer: (val) => val.replace(/^custom-/, ''),
        },
        {
            header: gettext('Base Model'),
            flex: 1,
            dataIndex: 'reported-model',
            autoEl: {
                tag: 'div',
                'data-qtip': gettext('CPU model the rest of the configuration is based on.'),
            },
        },
        {
            header: gettext('Physical Address Bits'),
            flex: 1,
            dataIndex: 'phys-bits',
        },
        {
            header: gettext('Hide Hypervisor'),
            flex: 1,
            dataIndex: 'hidden',
            renderer: (val) => Proxmox.Utils.format_boolean(val),
        },
        {
            header: gettext('Hyper-V Vendor'),
            flex: 1,
            dataIndex: 'hv-vendor-id',
        },
        {
            header: gettext('Flags'),
            flex: 2,
            dataIndex: 'flags',
        },
    ],

    tbar: [
        {
            text: gettext('Add'),
            handler: 'onAdd',
        },
        '-',
        {
            xtype: 'proxmoxStdRemoveButton',
            baseurl: '/api2/extjs/cluster/qemu/custom-cpu-models/',
            getRecordName: (rec) => rec.data.cputype,
            getUrl: function (rec) {
                let me = this;
                return me.baseurl + rec.data.cputype;
            },
            confirmMsg: function (rec) {
                return Ext.String.format(
                    gettext("Are you sure you want to remove the custom CPU model '{0}'?"),
                    rec.data.cputype.replace(/^custom-/, ''),
                );
            },
            callback: 'reload',
        },
        {
            xtype: 'proxmoxButton',
            text: gettext('Edit'),
            disabled: true,
            handler: 'onEdit',
        },
    ],

    selModel: {
        xtype: 'rowmodel',
    },

    listeners: {
        itemdblclick: function (_, rec) {
            let me = this;
            me.getController().showEditor(rec.data.cputype);
        },
    },

    initComponent: function () {
        let me = this;
        me.callParent();
        Proxmox.Utils.monStoreErrors(me, me.store);
    },
});
