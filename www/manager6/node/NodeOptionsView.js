Ext.define('Proxmox.node.NodeOptionsView', {
    extend: 'Proxmox.grid.ObjectGrid',
    alias: ['widget.proxmoxNodeOptionsView'],
    mixins: ['Proxmox.Mixin.CBind'],

    cwidth1: 250,

    cbindData: function (_initialconfig) {
        let me = this;

        let baseUrl = `/nodes/${me.nodename}/config`;
        me.url = `/api2/json${baseUrl}`;
        me.editorConfig = {
            url: `/api2/extjs/${baseUrl}`,
        };

        return {};
    },

    listeners: {
        itemdblclick: function () {
            this.run_editor();
        },
        activate: function () {
            this.rstore.startUpdate();
        },
        destroy: function () {
            this.rstore.stopUpdate();
        },
        deactivate: function () {
            this.rstore.stopUpdate();
        },
    },

    tbar: [
        {
            text: gettext('Edit'),
            xtype: 'proxmoxButton',
            disabled: true,
            handler: (btn) => btn.up('grid').run_editor(),
        },
    ],

    gridRows: [
        {
            xtype: 'integer',
            name: 'startall-onboot-delay',
            text: gettext('Start on boot delay'),
            minValue: 0,
            maxValue: 300,
            labelWidth: 130,
            deleteEmpty: true,
            renderer: function (value) {
                if (value === undefined) {
                    return Proxmox.Utils.defaultText;
                }

                // TODO: simplify once we can use ngetext
                let secString = value === '1' ? gettext('Second') : gettext('Seconds');
                return `${value} ${secString}`;
            },
        },
        {
            xtype: 'text',
            name: 'wakeonlan',
            text: gettext('MAC address for Wake on LAN'),
            vtype: 'MacAddress',
            labelWidth: 150,
            deleteEmpty: true,
            renderer: (value) => (value !== undefined ? value : Proxmox.Utils.NoneText),
        },
        {
            xtype: 'integer',
            name: 'ballooning-target',
            text: gettext('RAM usage target for ballooning'),
            minValue: 0,
            maxValue: 100,
            deleteEmpty: true,
            onlineHelp: 'qm_memory',
            renderer: (value) => (value !== undefined ? `${value}%` : gettext('Default (80%)')),
        },
    ],
});
